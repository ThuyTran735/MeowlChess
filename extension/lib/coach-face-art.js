// Static portraits and articulated faces share this small native vector scene.
// Pupils travel inside fixed eye outlines; the head and eyes never stretch.
const INK='#49382d';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:0));
const path=(d,fill='none',stroke=INK,width=5)=>({d,fill,stroke,width});
const ellipse=(cx,cy,rx,ry,fill)=>({cx,cy,rx,ry,fill,stroke:'none',width:0});
const IDS=['meowl','owl','paws','mellow','scout','evil'];
export const coachFaceId=id=>IDS.includes(id)?id:'meowl';
function eyeShape(cx,cy){
  const ry=36;
  return `M${cx-36} ${cy} C${cx-37} ${cy-ry*1.25} ${cx+35} ${cy-ry*1.25} ${cx+36} ${cy} C${cx+38} ${cy+ry*1.3} ${cx-36} ${cy+ry*1.3} ${cx-36} ${cy}Z`;
}
function markings(id){
  if(id==='evil')return [
    path('M493 294 Q522 288 552 301','none','#514850',6),
    path('M677 298 Q709 281 738 288','none','#514850',6)];
  if(id==='owl')return [path('M488 291 Q523 276 559 289 M672 291 Q707 280 744 294','none','#715941',9),path('M494 279 Q522 267 545 274 M685 278 Q711 272 735 282','none','#a68a61',4)];
  if(id==='paws')return [path('M485 291 Q526 284 564 303 M672 305 Q711 286 750 293','none','#53402d',11),path('M458 389 L483 397 M754 402 L781 392','none','#856344',8)];
  if(id==='mellow')return [path('M494 294 Q524 286 553 295 M676 297 Q706 289 737 298','none','#997b59',6),path('M482 396 Q499 404 513 397 M723 402 Q741 408 754 400','none','#d1a38a',5)];
  if(id==='scout')return [path('M486 282 Q522 263 553 281 M675 296 Q710 285 746 300','none','#665037',7),...[[484,400],[494,408],[508,402],[735,405],[748,413],[756,402]].map(([x,y])=>ellipse(x,y,3,3,'#9c7650'))];
  return [path('M491 292 Q516 283 541 290','none','#9b7a50',5)];
}
export function coachEyeArt(coachId,{blink=0,lookX=0,lookY=0}={}){
  return [...markings(coachFaceId(coachId)),...coachCommonEyeArt({blink,lookX,lookY})];
}

/** Every coach uses the normal Meowl's exact eye shape, ink, blink and gaze. */
export function coachCommonEyeArt({blink=0,lookX=0,lookY=0}={}){
  const closed=clamp(blink,0,1),x=clamp(lookX,-1,1)*8,y=clamp(lookY,-1,1)*6,scene=[];
  [[528,345],[706,348]].forEach(([cx,cy])=>{
    const d=eyeShape(cx,cy);
    if(closed>.97){scene.push(path(`M${cx-29} ${cy+13} Q${cx} ${cy+24} ${cx+29} ${cy+13}`,'none',INK,5));return;}
    const top=cy-44+closed*63,bottom=cy+51-closed*28;
    const shutter=`M${cx-53} ${top} Q${cx} ${top-closed*9} ${cx+53} ${top} L${cx+53} ${bottom} Q${cx} ${bottom+closed*9} ${cx-53} ${bottom}Z`;
    const inside=[path(d,'#332f26',INK,4)],px=cx+x,py=cy+y+3;
    inside.push(ellipse(px,py,22,26,'#2e2923'));
    inside.push(ellipse(px+9,py-13,5,5,'#fff2d8'));
    scene.push({clip:shutter,children:[{clip:d,children:inside},path(d,'none',INK,4)]});
    if(closed>.02)scene.push({clip:d,children:[path(`M${cx-53} ${top} Q${cx} ${top-closed*9} ${cx+53} ${top}`,'none',INK,4)]});
  });return scene;
}
export function coachMouthArt(coachId,amount=0){
  const id=coachFaceId(coachId),open=clamp(amount,0,1),line=id==='evil'?'#59474b':'#76563b',stem=path('M605 431 L605 445','none',line,5);
  if(id==='evil'){
    const depth=2+open*21;
    return [stem,
      path(`M588 450 Q607 457 633 446 Q623 ${455+depth} 609 ${455+depth} Q596 ${455+depth} 588 450Z`,'#694331',line,3.5),
      path(`M624 451 L630 448 L626 ${456+open*6}Z`,'#f7e7c9',line,1.5),
    ];
  }
  if(open>.04){const width=id==='mellow'?12:id==='owl'?13:17,depth=7+open*(id==='mellow'?18:23);return [stem,path(`M${605-width} 447 Q605 452 ${605+width} 447 Q${609+width} ${447+depth} 605 ${450+depth} Q${601-width} ${447+depth} ${605-width} 447Z`,'#694331',line,4),...(open>.55?[path(`M596 ${445+depth} Q605 ${440+depth} 614 ${445+depth}`,'none','#bc8374',4)]:[])];}
  const mouths={owl:'M586 453 Q597 456 605 445 Q615 456 626 452',paws:'M582 451 Q597 461 605 445 Q619 464 637 448',mellow:'M590 450 Q599 456 605 445 Q611 456 620 450',scout:'M587 454 Q597 458 605 445 Q618 456 630 447',meowl:'M586 457 Q599 452 605 445 Q611 454 625 457'};
  return [stem,path(mouths[id],'none',id==='mellow'?'#8b6c50':line,id==='paws'||id==='meowl'?5:4)];
}
function svgScene(shapes,prefix,serial={value:0}){return shapes.map(s=>{
  if(s.children){const id=`${prefix}-${serial.value++}`;return `<defs><clipPath id="${id}"><path d="${s.clip}"/></clipPath></defs><g clip-path="url(#${id})">${svgScene(s.children,prefix,serial)}</g>`;}
  const common=`fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"`;
  return s.d?`<path d="${s.d}" ${common}/>`:`<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" ${common}/>`;
}).join('');}
export function coachFaceSvg(id){return svgScene([...coachEyeArt(id),...coachMouthArt(id)],`face-${coachFaceId(id)}`);}
export function drawCoachFaceArt(context,shapes){for(const s of shapes){
  if(s.children){context.save();context.clip(new Path2D(s.clip));drawCoachFaceArt(context,s.children);context.restore();continue;}
  const ink=s.d?new Path2D(s.d):new Path2D();if(!s.d)ink.ellipse(s.cx,s.cy,s.rx,s.ry,0,0,Math.PI*2);
  if(s.fill!=='none'){context.fillStyle=s.fill;context.fill(ink);}if(s.stroke!=='none'&&s.width){context.strokeStyle=s.stroke;context.lineWidth=s.width;context.lineCap='round';context.lineJoin='round';context.stroke(ink);}
}}
