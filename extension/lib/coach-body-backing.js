const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const smooth=value=>{const t=clamp(value,0,1);return t*t*(3-2*t);};

function furPatch(source,width,coachId){
  const w=12,h=28;let best=null;
  // Sample painted tan fur, excluding cream chest, dark feather ink and alpha.
  const tan=o=>source[o+3]>250&&source[o]>175&&source[o]<235&&source[o+1]>135
    &&source[o]-source[o+1]>20&&source[o]-source[o+1]<58
    &&source[o+1]-source[o+2]>28&&source[o+1]-source[o+2]<70;
  // Evil's charcoal fur retains the source grain but uses a cool gray palette.
  // Exclude its silver chest, near-black ink and red clothes from the sample.
  const charcoal=o=>source[o+3]>250&&source[o]>75&&source[o]<180
    &&source[o+1]-source[o]>=-1&&source[o+1]-source[o]<=5
    &&source[o+2]-source[o]>=3&&source[o+2]-source[o]<=10;
  const fur=coachId==='evil'?charcoal:tan;
  for(const start of [468,736])for(let y=530;y<=1020-h;y+=7)for(let x=start;x<start+70;x+=5){
    let count=0,variation=0,last;
    for(let dy=0;dy<h;dy+=2)for(let dx=0;dx<w;dx+=2){const o=((y+dy)*width+x+dx)*4;
      if(fur(o))count++;if(last!==undefined)variation+=Math.abs(source[o]-last);last=source[o];}
    const score=count-variation*.002;
    if(!best||score>best.score)best={x,y,score};
  }
  const values=[],mean=[0,0,0];let count=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const o=((best.y+y)*width+best.x+x)*4;
    const pixel=[source[o],source[o+1],source[o+2]];values.push(pixel);
    if(fur(o)){count++;for(let c=0;c<3;c++)mean[c]+=pixel[c];}
  }
  for(let c=0;c<3;c++)mean[c]/=count||1;
  // The patch contains only low-contrast painted grain. Replace a stray edge
  // pixel with the sampled material mean rather than repeating dark streaks.
  for(const pixel of values)for(let c=0;c<3;c++)pixel[c]=mean[c]+clamp(pixel[c]-mean[c],-9,9);
  const mirror=(n,size)=>{const v=((Math.floor(n)%(size*2))+size*2)%(size*2);return v<size?v:size*2-v-1;};
  return (x,y)=>values[mirror(y,h)*w+mirror(x,w)];
}

function torsoOutline(context) {
  context.beginPath();context.moveTo(482,520);
  context.bezierCurveTo(456,554,444,603,444,655);
  context.bezierCurveTo(438,741,449,848,473,917);
  context.bezierCurveTo(486,957,507,991,536,1017);
  context.quadraticCurveTo(626,1058,723,1018);
  context.bezierCurveTo(758,988,781,952,798,909);
  context.bezierCurveTo(824,838,834,738,822,650);
  context.bezierCurveTo(816,595,797,550,772,520);
  context.quadraticCurveTo(626,566,482,520);context.closePath();
}
const LEFT_EDGE=[[520,482],[580,468],[648,488],[743,501],[840,500],[929,477],[958,467],[1020,536]];
const RIGHT_EDGE=[[520,772],[578,777],[668,761],[741,753],[836,759],[906,783],[953,819],[1020,723]];
function edgeAt(points,y){
  if(y<=points[0][0])return points[0][1];
  for(let i=1;i<points.length;i++){const[a,x]=points[i-1],[b,z]=points[i];if(y<=b)return x+(z-x)*(y-a)/(b-a);}
  return points.at(-1)[1];
}

/** Complete hidden fur from intact painted scanlines, once per puppet. */
export function createCoachBodyBacking(artwork,document=globalThis.document,coachId='meowl') {
  const backing=document.createElement('canvas');backing.width=artwork.width;backing.height=artwork.height;
  const context=backing.getContext('2d',{willReadFrequently:true});
  torsoOutline(context);context.fill();
  const mask=context.getImageData(0,0,backing.width,backing.height),pixels=mask.data;
  const source=artwork.getContext('2d',{willReadFrequently:true}).getImageData(0,0,artwork.width,artwork.height).data;
  const width=backing.width,texture=furPatch(source,width,coachId);
  for(let y=520;y<=1058;y++){
    let left=430,right=845;
    while(left<right&&pixels[(y*width+left)*4+3]<128)left++;
    while(right>left&&pixels[(y*width+right)*4+3]<128)right--;
    if(left===right)continue;
    // A stable source fur patch supplies the hidden flank. Blend only beside
    // the cut, so crossing a cream boundary cannot make a horizontal stripe.
    const from=edgeAt(LEFT_EDGE,y)+2,to=edgeAt(RIGHT_EDGE,y)-2;
    for(let x=left-1;x<=right+1;x++){
      const offset=(y*width+x)*4,coverage=pixels[offset+3];if(!coverage)continue;
      const sample=clamp(x,from,to);
      const a=Math.floor(sample),f=sample-a;
      const first=(y*width+a)*4,second=first+4;
      const grain=texture(x*.8,y*.8),edge=smooth(1-Math.abs(x-sample)/15);
      for(let channel=0;channel<3;channel++){
        const original=source[first+channel]*(1-f)+source[second+channel]*f;
        pixels[offset+channel]=Math.round(grain[channel]*(1-edge)+original*edge);
      }
      pixels[offset+3]=Math.round(coverage*source[offset+3]/255);
    }
  }
  context.putImageData(mask,0,0);
  // Match the original outline's painted brown, sampled from intact hip ink.
  const ink=[];
  for(let y=978;y<1020;y+=2)for(let x=480;x<535;x+=2){
    const o=(y*width+x)*4,[r,g,b,a]=source.subarray(o,o+4);
    const dark=coachId==='evil'?r<90&&g<95&&b<100&&b>=r:r>g&&g>b&&r<150&&g<120&&b<90;
    if(a>250&&dark)ink.push([r,g,b]);
  }
  if(ink.length){
    const channels=[0,1,2].map(channel=>Math.round(ink.reduce((sum,pixel)=>sum+pixel[channel],0)/ink.length));
    context.strokeStyle=`rgb(${channels.join(',')})`;context.lineWidth=8;context.lineJoin='round';
    torsoOutline(context);context.stroke();
    context.globalCompositeOperation='destination-in';context.drawImage(artwork,0,0);context.globalCompositeOperation='source-over';
  }
  return backing;
}
