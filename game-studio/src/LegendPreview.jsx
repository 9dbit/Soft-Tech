import React,{useEffect,useRef} from 'react';
import {exportLegendLayout} from './legendLink.js';
export default function LegendPreview({project,selection,preview,onSelect,onPointerDown,onPointerMove,onPointerUp}){
 const frame=useRef(null),latest=useRef(project);latest.current=project;
 const post=message=>{
  const target=frame.current?.contentWindow;
  if(!target)return false;
  // Keep the sender's JS frame alive across postMessage. A tail call from a
  // timer can make WebKit report the receiving frame as MessageEvent.source.
  // Returning after the call also preserves this behavior in the minified build.
  target.postMessage(message,location.origin);
  return true;
 };
 const send=()=>post({type:'skygate-editor-state',project:exportLegendLayout(latest.current),assets:{}});
 useEffect(()=>{const receive=e=>{if(e.source===frame.current?.contentWindow&&e.origin===location.origin&&e.data?.type==='skygate-editor-request')send();};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[]);
 useEffect(()=>{const t=setTimeout(()=>post({type:'legend-layout-update',layers:exportLegendLayout(latest.current).layers}),90);return()=>clearTimeout(t);},[project]);
 return <>
  <iframe ref={frame} title="Legend Ball shared game renderer" src={project.linked.renderer+'?universal=1'} style={{position:'absolute',inset:0,width:'100%',height:'100%',border:0,pointerEvents:preview?'auto':'none'}}/>
  {!preview&&project.layers.filter(l=>l.visible).map(l=>{const r=l.mobile||l;return <div key={l.id} data-linked-layer={l.id} title={l.name} style={{position:'absolute',left:r.x,top:r.y,width:r.width,height:r.height,zIndex:(l.native?.z||0)+1,outline:l.id===selection?'2px solid #55ccff':'none',pointerEvents:l.locked?'none':'auto',touchAction:'none',cursor:'move'}} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);onSelect(l.id);onPointerDown(e,l);}} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}/>;})}
 </>;
}
