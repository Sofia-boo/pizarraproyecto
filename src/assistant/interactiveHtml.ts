// Extract only a complete HTML document. It is imported as an inactive,
// sandboxed board widget; never execute model code in the assistant itself.
export function interactiveHtml(text:string):string|null{
  const blocks=[...text.matchAll(/```(?:html|htm)?\s*\n([\s\S]*?)```/gi)].map(match=>match[1].trim())
  for(const candidate of [...blocks,text.trim()]){
    if(/^(?:<!doctype\s+html[^>]*>\s*)?<html\b/i.test(candidate)&&/<\/html>\s*$/i.test(candidate))return candidate
  }
  return null
}
