"""
Limpeza heurística do texto extraído. Esta é a etapa mais "suja" e a que mais
vai precisar de iteração com livros reais — por isso cada heurística é isolada
e documentada, pra você ligar/desligar e ajustar sem quebrar o resto.

Problemas que resolvemos aqui:

1. Cabeçalho/rodapé repetido — número de página, título do livro/capítulo que
   o editor coloca em toda página. Aparece na MESMA posição vertical em muitas
   páginas. Detectamos por recorrência + posição.

2. Hifenização de fim de linha — "compre-\nhensão" deve virar "compreensão".
   Cuidado: nem todo hífen no fim de linha é separação silábica (ex.: "bem-\n
   estar" é hífen real). Heurística conservadora abaixo.

3. Quebras de linha de layout — o PDF quebra linha por largura da página, não
   por fim de parágrafo. Precisamos juntar linhas num parágrafo só, e só
   quebrar parágrafo quando há sinal real (linha curta, pontuação final +
   indentação, etc.).
"""

from __future__ import annotations

import re
from collections import Counter

from .extract import Line, PageContent


# ---------------------------------------------------------------------------
# 1. Detecção de cabeçalho/rodapé repetido
# ---------------------------------------------------------------------------

def _normalize_for_recurrence(text: str) -> str:
    """Normaliza um texto pra detectar recorrência de header/rodapé, colapsando
    variações que mudam de página pra página.

    Headers de livro frequentemente carregam números de página, números de
    capítulo (incl. romanos) e sofrem pequenos erros de OCR a cada página. Pra
    que todas as ocorrências contem como a MESMA coisa recorrente, reduzimos o
    texto a uma assinatura estável:
      - minúsculas
      - remove dígitos e algarismos romanos isolados
      - remove pontuação/símbolos
      - colapsa espaços
    Assim 'Vampire Hunter D+ VoLumz ONE | II' e '... ONE | III' viram a mesma
    chave, e o header é detectado como recorrente."""
    t = text.strip().lower()
    # remove algarismos romanos isolados (i, ii, iii, iv, v, vi, ... como tokens)
    t = re.sub(r"\b[ivxlcdm]+\b", " ", t)
    # remove dígitos
    t = re.sub(r"\d+", " ", t)
    # remove tudo que não for letra ou espaço (pontuação, |, +, ®, etc.)
    t = re.sub(r"[^a-zà-ÿ\s]", " ", t)
    # colapsa espaços
    t = re.sub(r"\s+", " ", t).strip()
    return t


def find_running_headers_footers(
    pages: list[PageContent],
    zone_ratio: float = 0.12,
    min_recurrence: float = 0.4,
) -> set[str]:
    """Retorna textos normalizados que recorrem como cabeçalho/rodapé.

    Duas estratégias combinadas, porque em PDFs de páginas escaneadas a posição
    vertical do header varia de página pra página (cada scan está deslocado):

      1. Por ZONA: texto na faixa de topo/base que se repete.
      2. Por RECORRÊNCIA GLOBAL: texto CURTO que aparece em muitas páginas em
         qualquer posição — pega headers que escaparam da zona por desalinhamento
         do scan (ex.: "Vampire Hunter D Vol. 1").

    A estratégia 2 só considera linhas curtas (≤ ~60 chars) pra não remover uma
    frase de corpo que por acaso se repete.
    """
    if len(pages) < 4:
        return set()

    zone_candidates: Counter[str] = Counter()
    global_candidates: Counter[str] = Counter()

    for page in pages:
        top_zone = page.height * zone_ratio
        bottom_zone = page.height * (1 - zone_ratio)
        seen_zone: set[str] = set()
        seen_global: set[str] = set()
        for line in page.lines:
            norm = _normalize_for_recurrence(line.text)
            if not norm:
                continue
            y0, y1 = line.bbox[1], line.bbox[3]
            if (y1 <= top_zone or y0 >= bottom_zone) and norm not in seen_zone:
                zone_candidates[norm] += 1
                seen_zone.add(norm)
            # recorrência global só pra linhas curtas (cara de header)
            if len(line.text.strip()) <= 60 and norm not in seen_global:
                global_candidates[norm] += 1
                seen_global.add(norm)

    zone_threshold = len(pages) * min_recurrence
    # global: limiar de 35%. Como a normalização agora reduz o header a uma
    # assinatura específica de palavras (sem números/romanos/pontuação), o risco
    # de uma frase de corpo recorrer com essa exatidão é baixo, então podemos
    # ser mais sensíveis pra pegar headers que o OCR escreve com variações.
    global_threshold = len(pages) * 0.35

    running = {t for t, c in zone_candidates.items() if c >= zone_threshold}
    running |= {t for t, c in global_candidates.items() if c >= global_threshold}
    return running


def strip_headers_footers(
    page: PageContent, running: set[str], zone_ratio: float = 0.12
) -> list[Line]:
    """Remove as linhas cujo texto normalizado está no conjunto `running`.
    Remove em qualquer posição — porque em scans o header pode aparecer fora da
    zona de topo/base por desalinhamento. Como `running` só contém textos que
    comprovadamente recorrem (headers/rodapés), removê-los onde quer que apareçam
    é seguro."""
    kept: list[Line] = []
    for line in page.lines:
        if _normalize_for_recurrence(line.text) in running:
            continue
        kept.append(line)
    return kept


# ---------------------------------------------------------------------------
# 1b. Filtro de linha-lixo de OCR
# ---------------------------------------------------------------------------

# tokens com cara de gibberish de OCR: mistura de maiúsculas no meio da palavra,
# sequências de letras+dígitos, etc. Não tentamos pegar tudo — só os padrões
# claros, pra não arriscar texto legítimo.


def _word_quality(text: str) -> float:
    """Pontua 0..1 quão 'texto real' uma linha parece. Baixo = provável lixo de
    OCR. Sinais usados: proporção de caracteres alfabéticos, e proporção de
    tokens que parecem palavras (só letras, com no máximo uma maiúscula inicial).
    Diálogos curtos legítimos pontuam alto (são palavras reais); 'PEXe cushine'
    e 'ZU2/03044' pontuam baixo."""
    stripped = text.strip()
    if not stripped:
        return 0.0

    # proporção de caracteres alfabéticos (vs dígitos/símbolos)
    alpha = sum(1 for c in stripped if c.isalpha())
    alpha_ratio = alpha / len(stripped)

    tokens = [t for t in re.split(r"\s+", stripped) if t]
    if not tokens:
        return 0.0

    def looks_like_word(tok: str) -> bool:
        # remove pontuação de borda (aspas, vírgula, ponto, travessão)
        core = tok.strip(".,;:!?\"'“”‘’()—-…")
        if not core:
            return False
        letters = [c for c in core if c.isalpha()]
        if not letters:
            return False
        # maiúsculas no MEIO da palavra (não a inicial) sugerem lixo: "KikucHI"
        inner_caps = sum(1 for c in core[1:] if c.isupper())
        # palavra plausível: maioria de letras e poucas maiúsculas internas
        return len(letters) / len(core) >= 0.6 and inner_caps <= 1

    good_tokens = sum(1 for t in tokens if looks_like_word(t))
    token_ratio = good_tokens / len(tokens)

    # média ponderada dos dois sinais
    return 0.4 * alpha_ratio + 0.6 * token_ratio


def is_ocr_garbage(text: str) -> bool:
    """Decide se uma linha é lixo de OCR a ser descartado.

    LIÇÃO DE CALIBRAÇÃO: tentar detectar gibberish curto formado por letras
    ('dida', 'cou', 'ew') é inviável sem dicionário — tipograficamente são
    idênticos a palavras reais curtas, e apagá-los arrisca remover conteúdo
    legítimo (diálogos, nomes). Então NÃO tentamos.

    Descartamos apenas o que é seguramente não-texto:
      - linha vazia
      - caractere isolado de símbolo ('%', '|')
      - tokens dominados por dígitos/símbolos no meio de letras ('ZU2/03044')
      - linhas curtas com baixíssima proporção alfabética

    Isso remove o lixo óbvio (códigos, símbolos soltos) e deixa o resto. Ruído
    textual curto sobra, mas é preferível a apagar texto real."""
    stripped = text.strip()
    if not stripped:
        return True

    # linhas longas são corpo real — nunca descarta
    if len(stripped) > 40:
        return False

    # caractere/símbolo isolado
    if len(stripped) <= 2 and not any(c.isalpha() for c in stripped):
        return True

    alpha = sum(1 for c in stripped if c.isalpha())
    digits = sum(1 for c in stripped if c.isdigit())
    alpha_ratio = alpha / len(stripped)

    # dominado por dígitos/símbolos (códigos tipo 'ZU2/03044', '895.6'36--dc22')
    if alpha_ratio < 0.4 and digits >= 2:
        return True

    # quase nenhum caractere alfabético numa linha curta
    if alpha_ratio < 0.3:
        return True

    return False


def strip_garbage_lines(lines: list[Line]) -> list[Line]:
    """Remove linhas que são seguramente lixo não-textual de OCR."""
    return [ln for ln in lines if not is_ocr_garbage(ln.text)]


# ---------------------------------------------------------------------------
# 2. De-hifenização
# ---------------------------------------------------------------------------

# Palavras onde o hífen é REAL e não deve ser removido ao juntar linhas.
# Lista conservadora; em PT-BR hífen real é comum (mal-estar, guarda-chuva...).
# Heurística: se o que vem depois do hífen começa com minúscula E a junção
# forma algo plausível, removemos. Se for ambíguo, preservamos o hífen.
_HYPHEN_END = re.compile(r"(\w+)-\s*$")


def dehyphenate(prev: str, nxt: str) -> str | None:
    """Se `prev` termina em hífen de quebra silábica, retorna a junção sem
    hífen. Senão retorna None (não é caso de de-hifenização)."""
    m = _HYPHEN_END.search(prev)
    if not m:
        return None
    nxt_stripped = nxt.lstrip()
    if not nxt_stripped:
        return None
    first_char = nxt_stripped[0]
    # se a próxima começa com maiúscula, provavelmente é hífen real (nome
    # composto, ex.: "Coca-\nCola") — preserva.
    if first_char.isupper():
        return None
    # junta removendo o hífen
    return prev[: m.start(1)] + m.group(1) + nxt_stripped


# ---------------------------------------------------------------------------
# 3. Junção de linhas em parágrafos
# ---------------------------------------------------------------------------

_SENTENCE_END = re.compile(r'[.!?…"”\')\]]\s*$')


def join_lines_to_paragraph(lines: list[str]) -> str:
    """Junta uma lista de linhas (já sabemos que pertencem ao mesmo parágrafo)
    num texto contínuo, tratando hifenização."""
    if not lines:
        return ""
    out = lines[0]
    for nxt in lines[1:]:
        joined = dehyphenate(out, nxt)
        if joined is not None:
            out = joined
        else:
            out = out.rstrip() + " " + nxt.lstrip()
    return out.strip()
