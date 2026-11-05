// Infant anatomy is prepared once from the original painted fur and feathers.
// The animation still moves rigid parts; it never stretches the character.
export function babyBodyFrame(context) {
  context.translate(626, 1150);
  context.scale(.99, .54);
  context.translate(-626, -1150);
}

export function babyHeadFrame(context) {
  context.translate(626, 1150 + (535 - 1150) * .54);
  context.scale(1.04, 1.09);
  context.translate(-626, -535);
}

export function babyWingFrame(context, side) {
  const x = side === 'left' ? 468 : 780, y = 624;
  context.translate(626 + (x - 626) * .99, 1150 + (y - 1150) * .54);
  // Uniform scaling keeps the original feather shapes when wings are raised.
  context.scale(.56, .56);
  context.translate(-x, -y);
}

const smooth = value => { const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t); };

/** Short ears and fuller cheeks retain the source drawing's ink and grain. */
export function prepareBabyArtwork(artwork) {
  const context=artwork.getContext('2d',{willReadFrequently:true}),width=artwork.width;
  const source=context.getImageData(0,0,width,artwork.height).data;
  const left=350,top=70,patch=context.createImageData(570,450);
  for(let y=top;y<top+patch.height;y++)for(let x=left;x<left+patch.width;x++){
    // Broaden the cheek arc, returning to the shared neck boundary at y520.
    const cheeks=1+.025*Math.sin(Math.PI*smooth((y-270)/250));
    let sx=626+(x-626)/cheeks,sy=y;
    if(y<270){
      const outer=1-Math.exp(-(((sx-626)/80)**2)),shorten=.43*outer;
      sy=(y-shorten*270)/(1-shorten);
    }
    // Short kitten muzzle: shrink the painted nose without repainting it.
    const nose=smooth(1-Math.hypot((sx-605)/48,(sy-420)/25));
    sx+=(sx-605)*.18*nose;sy+=(sy-420)*.15*nose;
    const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
    const samples=[[(iy*width+ix)*4,(1-fx)*(1-fy)],[(iy*width+ix+1)*4,fx*(1-fy)],
      [((iy+1)*width+ix)*4,(1-fx)*fy],[((iy+1)*width+ix+1)*4,fx*fy]];
    const out=((y-top)*patch.width+x-left)*4;
    let alpha=0;for(const[p,weight]of samples)alpha+=(source[p+3]||0)*weight;
    patch.data[out+3]=alpha;
    if(alpha>0)for(let c=0;c<3;c++){
      let channel=0;for(const[p,weight]of samples)channel+=(source[p+c]||0)*(source[p+3]||0)*weight;
      patch.data[out+c]=channel/alpha;
    }
  }
  context.putImageData(patch,left,top);
}
