export type CameraView={center:{x:number;y:number};zoom:number;viewport?:{width:number;height:number};following?:string}
export function fitFollowCamera(view:CameraView,width:number,height:number){
  const zoom=Math.max(.01,Math.min(5,view.zoom*(view.viewport?Math.min(width/view.viewport.width,height/view.viewport.height):1)))
  return {zoom,x:width/2-view.center.x*zoom,y:height/2-view.center.y*zoom}
}
export function followCycle(target:string,self:string|null,views:Map<string,CameraView>){
  const visited=new Set<string>()
  let next:string|undefined=target
  while(next){if(next===self||visited.has(next))return true;visited.add(next);next=views.get(next)?.following}
  return false
}
