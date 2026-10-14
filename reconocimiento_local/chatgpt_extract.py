"""Parse only an already-authorized assistant reply with Scrapling.

No fetchers, adaptive storage, cookies, login pages or whole-page snapshots.
"""
import re
from scrapling.parser import Selector

IGNORED = {'script', 'style', 'button', 'input', 'textarea', 'form', 'iframe', 'svg', 'noscript', 'template', '#comment'}


def extract_answer_html(fragment: str) -> str:
    if not isinstance(fragment, str) or len(fragment) > 1_000_000:
        raise ValueError('Respuesta HTML no válida.')
    document = Selector(fragment, adaptive=False, huge_tree=False)

    def render(node, depth=0):
        if depth > 64: return ''
        tag = node.tag.lower()
        if tag in IGNORED: return ''
        if tag == '#text': return str(node.text)
        classes = node.attrib.get('class', '').split()
        if 'katex-display' in classes or 'katex' in classes or tag == 'math':
            latex = node.css('annotation[encoding="application/x-tex"]::text').get()
            if latex:
                return '\n$$\n' + latex + '\n$$\n' if 'katex-display' in classes else '$' + latex + '$'
        if tag == 'pre':
            code = node.css('code')
            text = (code[0] if code else node).get_all_text(separator='', valid_values=False)
            fence = '`' * max(3, max((len(match) for match in re.findall(r'`+', text)), default=0) + 1)
            return '\n' + fence + '\n' + text + '\n' + fence + '\n'
        children = ''.join(render(child, depth + 1) for child in node.xpath('./node()'))
        if re.fullmatch(r'h[1-6]', tag): return '\n' + '#' * int(tag[1]) + ' ' + children + '\n'
        if tag in ('p', 'div', 'ul', 'ol', 'table', 'article', 'section'): return '\n' + children + '\n'
        if tag == 'li': return '\n' + ('1. ' if node.parent and node.parent.tag == 'ol' else '- ') + children
        if tag in ('strong', 'b'): return '**' + children + '**'
        if tag == 'code': return '`' + children + '`'
        if tag == 'br': return '\n'
        if tag == 'tr': return children + '\n'
        if tag in ('td', 'th'): return children + ' | '
        if tag == 'img': return node.attrib.get('alt', '')
        return children

    return re.sub(r'\n{3,}', '\n\n', render(document)).strip()[:60000]
