// A palette change preserves the original tabby brushwork, feather edges and
// alpha. The muted pink nose is retained separately by the asset builder.
export const EVIL_FUR_PALETTE=Object.freeze({shadow:'#28262d',fur:'#66656c',silver:'#d4d5da',outline:'#302d35'});
export function evilFurColor(red,green,blue){
  const light=red*.2126+green*.7152+blue*.0722;
  const stops=[[0,18],[60,40],[120,81],[180,133],[235,215],[255,231]];
  let value=231;
  for(let i=1;i<stops.length;i++)if(light<=stops[i][0]){
    const[a,from]=stops[i-1],[b,to]=stops[i];value=from+(to-from)*(light-a)/(b-a);break;
  }
  return [Math.max(0,Math.round(value-3)),Math.max(0,Math.round(value-2)),Math.min(255,Math.round(value+3))];
}

// Horns sit between the independently moving ears and remain with the head.
// Bounds: x548..704, y122..229, safely within the unchanged rigid head crop.
export const DEVIL_HORNS_SVG=`<g stroke="#383039" stroke-width="8" stroke-linejoin="round" stroke-linecap="round">
  <path fill="#c6b6a3" d="M560 224 C548 196 548 155 568 123 C562 158 575 185 593 211 L589 228 Z"/>
  <path fill="#c6b6a3" d="M692 224 C704 196 704 155 684 123 C690 158 677 185 659 211 L663 228 Z"/>
  <path fill="none" stroke="#e3d6c3" stroke-width="5" d="M562 201 Q554 172 565 142 M690 201 Q698 172 687 142"/>
  <path fill="none" stroke="#8d7c71" stroke-width="5" d="M558 212 L578 218 M694 212 L674 218"/>
</g>`;
