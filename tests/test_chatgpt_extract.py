import unittest
from reconocimiento_local.chatgpt_extract import extract_answer_html


class ExtractTest(unittest.TestCase):
    def test_scrapling_keeps_math_lists_code_and_headings_without_controls_or_remote_content(self):
        fragment='''<div class="markdown"><h2>Solución</h2><p>El <strong>resultado</strong> es
        <span class="katex"><span class="katex-mathml"><math><semantics><mrow>duplicado</mrow><annotation encoding="application/x-tex">\u005cfrac{1}{2}</annotation></semantics></math></span><span class="katex-html">duplicado</span></span>.</p>
        <span class="katex-display"><span class="katex"><math><annotation encoding="application/x-tex">x=\u005cfrac{1}{2}</annotation></math></span></span>
        <ul><li>Primero <code>x</code></li><li>Después</li></ul><pre><code>SELECT 1;\nSELECT 2;</code></pre>
        <button>Copiar</button><form><input value="credential-sentinel"></form><script>fetch('https://wrong.example')</script><img src="https://wrong.example/image" alt="Diagrama"></div>'''
        text=extract_answer_html(fragment)
        self.assertIn('## Solución',text)
        self.assertIn('$\\frac{1}{2}$',text)
        self.assertIn('$$\nx=\\frac{1}{2}\n$$',text)
        self.assertIn('- Primero `x`',text)
        self.assertIn('```\nSELECT 1;\nSELECT 2;\n```',text)
        self.assertIn('Diagrama',text)
        for excluded in ('duplicado','Copiar','credential-sentinel','wrong.example','fetch('):self.assertNotIn(excluded,text)

    def test_html_entities_and_text_between_tags_keep_word_spaces(self):
        self.assertEqual(extract_answer_html('<p>Una <b>base</b> &lt; otra &amp; dos.</p>'),'Una **base** < otra & dos.')

    def test_oversized_fragments_are_rejected_without_parsing(self):
        with self.assertRaises(ValueError):extract_answer_html('x'*1000001)


if __name__=='__main__':unittest.main()
