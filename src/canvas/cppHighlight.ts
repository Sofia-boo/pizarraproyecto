export type CodeToken={text:string;kind:'plain'|'comment'|'string'|'keyword'|'number'|'directive'|'type'}
const keywords=new Set('alignas alignof asm auto break case catch class const constexpr consteval continue default delete do else enum explicit export extern false for friend goto if inline namespace new noexcept nullptr operator private protected public register return sizeof static struct switch template this thread_local throw true try typedef typename union using virtual volatile while'.split(' '))
const types=new Set('void bool char double float int long short signed unsigned wchar_t size_t string vector cout cin cerr endl std'.split(' '))
export const CODE_COLORS={plain:'#d4d4d4',comment:'#6a9955',string:'#ce9178',keyword:'#c586c0',number:'#b5cea8',directive:'#569cd6',type:'#4ec9b0'}
export function cppTokens(source:string):CodeToken[] {
  const pattern=/(\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|^[ \t]*#[^\n]*|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[uUlLfF]*\b|\b[A-Za-z_]\w*\b)/gm
  const result:CodeToken[]=[];let end=0
  for(const match of source.matchAll(pattern)) {
    if(match.index!>end)result.push({text:source.slice(end,match.index),kind:'plain'})
    const text=match[0],kind=text.startsWith('//')||text.startsWith('/*')?'comment':/^["']/.test(text)?'string':/^\s*#/.test(text)?'directive':/^\d/.test(text)?'number':keywords.has(text)?'keyword':types.has(text)?'type':'plain'
    result.push({text,kind});end=match.index!+text.length
  }
  if(end<source.length)result.push({text:source.slice(end),kind:'plain'})
  return result
}
