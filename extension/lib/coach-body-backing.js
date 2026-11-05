const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const smooth=value=>{const t=clamp(value,0,1);return t*t*(3-2*t);};

// Long, uneven feather groups follow the same direction as the painted thighs.
// They stay with the torso beneath the wings and clothes; quieter secondary
// marks break up the gaps without making a regular grid of short dashes.
const BODY_FEATHERS = [
  'M468 617 C465 641 458 664 459 691 C459 710 463 728 469 739 C470 720 466 706 467 685 C466 661 472 639 471 625 Q471 618 468 617 Z',
  'M482 710 C476 739 477 763 481 789 C483 807 487 825 492 839 C494 824 489 807 488 787 C484 760 486 740 486 723 Q486 714 482 710 Z',
  'M456 778 C455 807 461 839 467 863 C471 879 477 896 482 906 C483 890 477 874 475 858 C468 828 465 802 462 788 Q460 780 456 778 Z',
  'M480 882 C479 905 485 928 494 948 C499 959 505 969 510 974 C508 958 501 945 498 933 C489 911 487 893 484 885 Q482 881 480 882 Z',
  'M798 610 C803 635 801 661 796 682 C792 701 786 721 781 732 C779 718 786 698 788 679 C794 653 791 632 794 617 Q795 611 798 610 Z',
  'M813 682 C821 710 820 735 816 761 C814 780 809 798 804 811 C802 797 808 779 807 759 C812 732 808 708 808 693 Q809 685 813 682 Z',
  'M781 748 C777 771 773 798 777 823 C778 844 782 863 787 875 C789 859 784 842 785 823 C781 798 786 775 786 759 Q785 751 781 748 Z',
  'M823 815 C829 842 825 871 821 894 C817 914 810 935 802 946 C801 931 809 910 811 892 C816 868 815 843 818 826 Q820 817 823 815 Z',
  'M797 892 C791 912 788 932 781 948 C775 961 768 971 763 978 C773 975 782 965 789 952 C796 935 801 914 801 901 Q801 894 797 892 Z',
];
const SOFT_BODY_FEATHERS = [
  'M452 670 C447 689 447 714 452 732 C452 708 456 692 456 678 Q455 671 452 670 Z',
  'M492 819 C488 835 490 853 495 865 C496 850 497 837 496 827 Q495 820 492 819 Z',
  'M808 638 C814 654 815 670 813 684 C809 670 807 658 805 647 Q804 640 808 638 Z',
  'M799 793 C796 810 797 829 802 842 C803 825 805 811 803 801 Q802 795 799 793 Z',
];

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
  context.bezierCurveTo(438,741,449,867,467,958);
  context.bezierCurveTo(486,1000,507,1010,536,1017);
  context.quadraticCurveTo(626,1058,723,1018);
  context.bezierCurveTo(780,1008,818,981,832,955);
  context.bezierCurveTo(844,860,834,738,822,650);
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
    // Keep the painted grain beneath the separate feather markings. The middle
    // stays the original chest, and only the internal join is softly blended.
    const from=edgeAt(LEFT_EDGE,y)+2,to=edgeAt(RIGHT_EDGE,y)-2;
    for(let x=left-1;x<=right+1;x++){
      const offset=(y*width+x)*4,coverage=pixels[offset+3];if(!coverage)continue;
      const sample=clamp(x,from,to);
      const a=Math.floor(sample),f=sample-a;
      const first=(y*width+a)*4,second=first+4;
      const grain=texture(x*.8,y*.8),edge=smooth(1-Math.abs(x-sample)/10);
      for(let channel=0;channel<3;channel++){
        const original=source[first+channel]*(1-f)+source[second+channel]*f;
        pixels[offset+channel]=Math.round(grain[channel]*(1-edge)+original*edge);
      }
      pixels[offset+3]=coverage;
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
    context.fillStyle=`rgb(${channels.join(',')})`;
    context.save();torsoOutline(context);context.clip();
    context.globalAlpha=.32;
    for(const path of SOFT_BODY_FEATHERS)context.fill(new Path2D(path));
    context.globalAlpha=1;
    for(const path of BODY_FEATHERS)context.fill(new Path2D(path));
    context.restore();
    context.strokeStyle=`rgb(${channels.join(',')})`;context.lineWidth=8;context.lineJoin='round';
    torsoOutline(context);context.stroke();
  }
  // Preserve the original exterior fur fringe at rest. This is the complete
  // source silhouette, not the cut-out front with the wing areas erased.
  context.globalCompositeOperation='destination-in';context.drawImage(artwork,0,0);
  context.globalCompositeOperation='source-over';
  return backing;
}
