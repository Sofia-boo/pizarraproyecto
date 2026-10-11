import {test} from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/ocr-setup.js'

test('Vercel pairs its private OCR key only with the configured backend',async t=>{
  const ticket='a'.repeat(64)
  const invoke=body=>handler.fetch(new Request('https://pizarraproyecto.vercel.app/integrations/ocr-link',{method:'POST',body:JSON.stringify(body)}))
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.match(url,/^https:\/\/[^/]+\.trycloudflare\.com\/api\/ocr\/setup-private$/)
    assert.equal(options.redirect,'error')
    assert.deepEqual(JSON.parse(options.body),{ticket,api_key:'unit-test-secret'})
    return Response.json({configured:true})
  })
  const old=process.env.ocrkey,oldDatalab=process.env.DATALAB_API_KEY
  try {
    process.env.ocrkey='unit-test-secret';delete process.env.DATALAB_API_KEY
    assert.equal((await handler.fetch(new Request('https://example.com'))).status,405)
    assert.equal((await invoke({ticket:'invalid'})).status,403)
    assert.equal((await invoke({ticket,padding:'x'.repeat(2000)})).status,413)
    const response=await invoke({ticket})
    assert.equal(response.status,200)
    assert.equal(response.headers.get('Cache-Control'),'private, no-store')
    assert.deepEqual(await response.json(),{configured:true})
    delete process.env.ocrkey
    assert.equal((await invoke({ticket})).status,503)
    assert.equal(globalThis.fetch.mock.callCount(),1)
  }finally {
    if(old===undefined)delete process.env.ocrkey;else process.env.ocrkey=old
    if(oldDatalab===undefined)delete process.env.DATALAB_API_KEY;else process.env.DATALAB_API_KEY=oldDatalab
  }
})
