import type { Point } from '../storage/database'

export const PEN_RECOVERY_MS=100
export type PenBreak = {at:number;point:Point;camera:{x:number;y:number;zoom:number};color:string;width:number;highlighter:boolean}
/** Only bridge nearby contacts after a very brief dropout; never draw hover events. */
export function canResumePen(previous:PenBreak,now:number,point:Point,camera:PenBreak['camera'],brush:Pick<PenBreak,'color'|'width'|'highlighter'>):boolean {
  return now>=previous.at && now-previous.at<=PEN_RECOVERY_MS &&
    camera.x===previous.camera.x && camera.y===previous.camera.y && camera.zoom===previous.camera.zoom &&
    brush.color===previous.color && brush.width===previous.width && brush.highlighter===previous.highlighter &&
    Math.hypot(point.x-previous.point.x,point.y-previous.point.y)*camera.zoom<=18
}
