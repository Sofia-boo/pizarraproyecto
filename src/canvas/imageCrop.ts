export type ImageCrop={x:number;y:number;width:number;height:number}
export const fullImage:ImageCrop={x:0,y:0,width:1,height:1}
export function cropFromPoints(a:{x:number;y:number},b:{x:number;y:number}):ImageCrop {
  return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)}
}
export function cropPixels(crop:ImageCrop,width:number,height:number){
  const left=Math.max(0,Math.min(width-1,Math.floor(crop.x*width)))
  const top=Math.max(0,Math.min(height-1,Math.floor(crop.y*height)))
  const right=Math.max(left+1,Math.min(width,Math.ceil((crop.x+crop.width)*width)))
  const bottom=Math.max(top+1,Math.min(height,Math.ceil((crop.y+crop.height)*height)))
  return {left,top,width:right-left,height:bottom-top,region:{x:left/width,y:top/height,width:(right-left)/width,height:(bottom-top)/height}}
}
export function croppedGeometry(item:{x:number;y:number;width:number;height:number;rotation?:number},crop:ImageCrop){
  const width=item.width*crop.width,height=item.height*crop.height,angle=item.rotation??0
  const dx=item.width*(crop.x+crop.width/2-.5),dy=item.height*(crop.y+crop.height/2-.5)
  return {x:item.x+item.width/2+dx*Math.cos(angle)-dy*Math.sin(angle)-width/2,
    y:item.y+item.height/2+dx*Math.sin(angle)+dy*Math.cos(angle)-height/2,width,height}
}
