// Original editable costume layers shared by the builder and rigid animation.
const outline = 'stroke="#49382d" stroke-width="12" stroke-linejoin="round" stroke-linecap="round"';
export const COACH_GARMENT_SVG = {
  meowl: '',
  owl: `<g ${outline}>
    <path fill="#657d91" d="M481 526 Q606 558 777 526 L749 665 L746 953 L641 1003 L605 972 L546 1001 L507 943 L507 661 Z"/>
    <path fill="#ece2c9" d="M516 535 Q618 570 743 535 L631 699 Z"/>
    <path fill="#496175" d="M484 529 L552 547 L604 667 L550 640 L523 677 L505 607 Z M776 529 L709 547 L648 672 L703 642 L735 674 L752 605 Z"/>
    <path fill="#805b56" d="M575 553 L615 568 L662 550 L670 596 L626 583 L582 600 Z"/>
    <rect x="610" y="561" width="28" height="31" rx="7" fill="#aa7970"/>
    <path fill="#465d70" d="M531 789 L588 788 L588 849 L533 851 Z M674 789 L726 785 L726 845 L674 850 Z"/>
    <path fill="#e1c88c" stroke-width="7" d="M676 766 Q691 759 705 769 Q716 758 730 762 L730 798 Q716 797 705 805 Q690 797 676 802 Z"/>
    <path fill="none" stroke-width="6" d="M705 770 V803"/>
    <g fill="#d5be84" stroke-width="7"><circle cx="628" cy="743" r="11"/><circle cx="628" cy="823" r="11"/><circle cx="628" cy="903" r="11"/></g>
    <path fill="none" stroke="#8197a8" stroke-width="7" d="M524 920 L549 958 M727 918 L652 960"/>
  </g>`,
  paws: `<g ${outline}>
    <path fill="#3f4c65" d="M480 534 Q623 574 779 534 L752 653 L755 886 L707 972 L626 945 L547 971 L504 893 L503 653 Z"/>
    <path fill="#e9dfc2" d="M554 566 L623 583 L693 564 L657 916 L594 917 Z"/>
    <path fill="#53617c" d="M481 540 L551 564 L593 664 L540 636 L509 675 Z M777 541 L707 560 L662 666 L715 639 L748 675 Z"/>
    <path fill="#d6b772" d="M477 559 L532 571 L527 600 L474 588 Z M727 570 L780 559 L782 588 L732 601 Z"/>
    <g fill="#e2c17a" stroke-width="7"><circle cx="555" cy="727" r="13"/><circle cx="696" cy="727" r="13"/><circle cx="555" cy="803" r="13"/><circle cx="696" cy="803" r="13"/><circle cx="555" cy="879" r="13"/><circle cx="696" cy="879" r="13"/></g>
    <path fill="#efa854" d="M468 500 Q533 516 621 551 Q707 525 788 497 L801 529 Q710 581 627 581 Q535 573 456 534 Z"/>
    <path fill="#d79045" d="M609 576 Q572 617 572 659 Q604 649 628 607 Q636 653 669 681 Q689 633 649 575 Z"/>
    <ellipse cx="628" cy="564" rx="27" ry="24" fill="#f4b25e"/>
    <path fill="none" stroke="#8590a3" stroke-width="7" d="M526 912 L549 942 M723 913 L706 944"/>
  </g>`,
  mellow: `<g ${outline}>
    <path fill="#9b83ad" d="M535 198 C501 166 531 112 589 103 C646 88 701 104 733 143 C759 172 751 202 724 214 L555 226 Z"/>
    <path fill="#766084" d="M550 205 Q638 188 725 213 L717 239 Q633 220 554 235 Z"/>
    <path fill="none" stroke="#b9a4c5" stroke-width="9" d="M560 165 Q583 131 624 130"/>
    <path fill="#9d899f" d="M474 520 Q617 561 780 519 L759 659 L751 941 Q698 979 634 970 Q566 984 509 947 L498 658 Z"/>
    <path fill="#c6b6c5" d="M481 526 Q545 549 614 553 L626 968 L597 970 L582 592 L502 574 Z M779 526 Q710 547 642 553 L626 968 L654 969 L671 592 L754 575 Z"/>
    <path fill="#88728f" d="M524 789 Q553 797 582 786 L584 876 Q554 890 525 875 Z M677 786 Q707 799 734 786 L732 875 Q704 888 676 875 Z"/>
    <path fill="none" stroke="#bba8bd" stroke-width="7" d="M516 916 Q561 937 596 925 M658 925 Q698 936 741 917 M539 808 V854 M556 810 V860 M691 810 V859 M711 811 V855"/>
    <g fill="#d7c0a0" stroke-width="7"><circle cx="628" cy="684" r="11"/><circle cx="628" cy="760" r="11"/><circle cx="628" cy="836" r="11"/><circle cx="628" cy="911" r="11"/></g>
    <path fill="#e5d1a4" stroke-width="7" d="M707 656 C674 650 669 697 704 710 C685 689 689 671 707 656 Z"/>
    <path fill="#b3a1bd" d="M465 501 Q593 555 784 503 Q808 515 792 541 Q650 596 471 547 Q449 532 465 501 Z"/>
    <path fill="#9b83ad" d="M705 550 Q753 574 761 626 L740 677 L690 657 Q679 600 681 560 Z"/>
    <path fill="#c2b3cb" d="M684 548 Q710 535 729 552 L740 580 L696 595 L676 576 Z"/>
    <path fill="none" stroke="#776184" stroke-width="8" d="M709 602 L714 636 M719 656 L733 661 M695 647 L708 652"/>
  </g>`,
  scout: `<g ${outline}>
    <path fill="#728965" d="M540 198 Q532 111 616 104 Q696 99 729 182 L723 223 L549 224 Z"/>
    <path fill="none" stroke="#95a582" stroke-width="9" d="M578 146 Q624 123 676 151"/>
    <path fill="#526b4c" d="M540 195 Q633 181 728 207 Q757 216 743 235 Q650 244 539 221 Z"/>
    <path fill="#d4b46e" stroke-width="8" d="M623 161 L638 143 L654 165 L641 183 Z"/>
    <path fill="#738568" d="M480 522 L548 541 L619 659 L693 542 L777 522 L749 658 L749 935 L673 959 L624 921 L571 957 L504 932 L507 657 Z"/>
    <path fill="#51664c" d="M482 527 L553 547 L576 628 L528 609 L504 660 Z M774 527 L693 549 L672 630 L724 609 L749 658 Z"/>
    <path fill="#859476" d="M519 716 L581 720 L581 797 L519 792 Z M674 720 L734 716 L732 792 L674 797 Z"/>
    <path fill="#a7ae83" d="M516 712 L585 715 L577 744 L523 743 Z M670 715 L738 712 L731 742 L680 744 Z"/>
    <g fill="#d1b56e" stroke-width="7"><circle cx="550" cy="730" r="7"/><circle cx="705" cy="730" r="7"/></g>
    <path fill="#99764f" d="M500 548 L527 533 L748 877 L720 899 Z"/>
    <path fill="#9c7b52" d="M636 841 L737 818 L750 903 L650 930 Z"/>
    <path fill="#b18b5b" d="M633 838 L739 814 L746 858 L646 883 Z"/>
    <rect x="686" y="859" width="23" height="29" rx="5" fill="#d1b56e" stroke-width="7"/>
    <path fill="#718b67" d="M467 500 Q588 553 785 501 L799 535 Q722 574 655 579 L620 647 L581 574 Q518 564 453 532 Z"/>
    <path fill="#9aaa83" stroke-width="8" d="M584 561 Q621 544 653 566 L640 592 L603 591 Z"/>
    <path fill="#e7d5a1" stroke-width="8" d="M610 646 Q630 633 649 647 L655 684 Q637 703 615 689 Z"/>
    <path fill="#647c5b" stroke="none" d="M633 650 L644 682 L624 675 Z"/>
    <path fill="#b68d4c" stroke="none" d="M633 650 L624 675 L632 670 Z"/>
  </g>`,
  evil: `<g stroke="#3c2e34" stroke-width="12" stroke-linejoin="round" stroke-linecap="round">
    <path fill="#852d3a" d="M483 532 Q625 565 776 532 L748 665 L750 936 L698 971 L626 947 L553 971 L505 936 L505 662 Z"/>
    <path fill="#a4434b" d="M555 565 Q626 586 698 565 L684 908 L626 932 L569 909 Z"/>
    <path fill="#682735" d="M483 534 L555 565 L575 683 L531 649 L504 677 Z M776 534 L698 565 L676 683 L725 649 L749 677 Z"/>
    <path fill="#9c3c46" d="M474 536 L482 492 Q542 535 623 551 Q704 534 779 491 L788 535 Q705 575 626 580 Q547 576 474 536 Z"/>
    <path fill="#452d36" d="M485 509 Q547 548 623 564 Q703 548 777 507 L771 534 Q700 569 626 580 Q551 569 492 537 Z"/>
    <path fill="none" stroke="#d49a6c" stroke-width="5" d="M515 919 L553 948 L621 929 M633 929 L699 947 L739 918"/>
    <path fill="none" stroke="#652b37" stroke-width="5" d="M591 620 L591 871 M660 620 L660 871"/>
    <path fill="#b48c54" stroke-width="7" d="M605 561 Q625 552 647 561 L654 579 L641 599 L611 599 L598 579 Z"/>
    <path fill="#d9b77b" stroke-width="5" d="M617 566 L627 560 L638 566 L638 583 L627 591 L616 583 Z"/>
    <g fill="#d1aa69" stroke-width="6"><circle cx="626" cy="692" r="9"/><circle cx="626" cy="778" r="9"/><circle cx="626" cy="864" r="9"/></g>
  </g>`,
};

// Hidden fabric continues across the body behind the articulated wings. The
// original front details are unchanged; replace the base path itself so its
// former side outline cannot become a second seam down the middle of the coat.
// Static portraits use the same fabric geometry, restoring the original wing
// artwork on top. That keeps the visible resting coat identical to animation.
// Follow the completed torso down to the hip, not the old narrower wing cut.
// Each outfit keeps its own collar, front details and lower hem.
const RIGHT_FLANK = 'C797 550 816 595 822 650 C834 738 844 860 832 955';
const LEFT_FLANK = 'C449 867 438 741 444 655 C444 603 456 554';
const HIDDEN_BASES = {
  owl: {
    'M481 526': `M481 526 Q606 558 777 526 ${RIGHT_FLANK} Q800 984 746 953 L641 1003 L605 972 L546 1001 Q506 990 467 958 ${LEFT_FLANK} 481 526 Z`,
  },
  paws: {
    'M480 534': `M480 534 Q623 574 779 534 ${RIGHT_FLANK} Q780 988 707 972 L626 945 L547 971 Q496 985 467 958 ${LEFT_FLANK} 480 534 Z`,
  },
  mellow: {
    'M474 520': `M474 520 Q617 561 780 519 ${RIGHT_FLANK} Q790 980 751 941 Q698 979 634 970 Q566 984 509 947 Q482 973 467 958 ${LEFT_FLANK} 474 520 Z`,
  },
  scout: {
    'M480 522': `M480 522 L548 541 L619 659 L693 542 L777 522 ${RIGHT_FLANK} Q790 980 749 935 L673 959 L624 921 L571 957 Q520 982 467 958 ${LEFT_FLANK} 480 522 Z`,
  },
  evil: {
    'M483 532': `M483 532 Q625 565 776 532 ${RIGHT_FLANK} Q780 994 698 971 L626 947 L553 971 Q499 987 467 958 ${LEFT_FLANK} 483 532 Z`,
  },
};
const scenes = new Map();

// The side panels use the outfit's own cloth colors. Long, quiet folds give
// the completed underarm some volume without adding a second side outline.
const SIDE_CLOTH = {
  owl: { shade: '#5b7185', light: '#71889b' },
  paws: { shade: '#37445c', light: '#4a5871' },
  mellow: { shade: '#927f96', light: '#aa97ac' },
  scout: { shade: '#687a5f', light: '#809174' },
  evil: { shade: '#772833', light: '#943743' },
};

function sideClothSvg(coachId) {
  const cloth=SIDE_CLOTH[coachId];if(!cloth)return '';
  const folds=`<g stroke="none" fill="${cloth.shade}">
    <path d="M452 634 C445 679 447 741 457 784 L463 774 C455 726 455 670 460 642 Q458 635 452 634 Z"/>
    <path d="M477 682 Q470 720 481 758 L485 763 Q479 723 483 691 Z"/>
    <path d="M461 837 C459 878 466 918 478 944 L483 939 C473 903 472 865 468 844 Z"/>
    <path d="M819 643 C833 707 837 782 834 846 L826 838 C829 773 824 703 813 656 Z"/>
    <path d="M794 690 Q788 721 798 750 L803 757 Q798 721 802 697 Z"/>
    <path d="M828 868 Q834 914 821 947 L813 951 Q821 912 820 880 Z"/>
  </g>`;
  // Cardigan ribbing, tailored seams, and field-jacket stitching stay modest
  // at avatar size. They are part of the cached torso, never per-frame effects.
  const detail=coachId==='mellow'
    ? 'M467 815 Q466 867 478 918 M474 820 Q473 866 483 901 M817 793 Q822 850 814 899 M810 802 Q814 848 809 883'
    : coachId==='scout'
      ? 'M462 674 L461 702 M461 718 L463 745 M464 761 L467 788 M824 724 L827 752 M828 769 L829 795 M829 811 L828 837'
      : coachId==='evil'
        ? 'M461 669 Q455 733 464 777 M825 708 Q832 773 829 826'
        : 'M462 663 Q455 725 464 774 M824 715 Q830 770 827 820';
  return `${folds}<path fill="none" stroke="${cloth.light}" stroke-width="3" stroke-linecap="round" d="${detail}"/>`;
}

function expandedPath(coachId,d) {
  for(const [prefix,replacement]of Object.entries(HIDDEN_BASES[coachId]||{}))if(d.startsWith(prefix))return replacement;
  return d;
}

/** Exact shared fabric paths for the static portrait builder. */
export function coachGarmentSvg(coachId) {
  return (COACH_GARMENT_SVG[coachId]||'').replace(/\bd="([^"]*)"/g,(_attribute,d)=>`d="${expandedPath(coachId,d)}"`)+sideClothSvg(coachId);
}

// Compile this module's own small SVG primitive vocabulary once. No DOM or
// network parsing is involved, and every original path/color stays literal.
function garmentScene(coachId) {
  if(scenes.has(coachId))return scenes.get(coachId);
  const source=(COACH_GARMENT_SVG[coachId]||'')+sideClothSvg(coachId),stack=[{}],shapes=[];
  for(const tag of source.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-z]+)\b([^>]*)>/g)) {
    const [,closing,name,text]=tag;if(!name)continue;
    if(closing){if(name==='g')stack.pop();continue;}
    const attributes={...stack.at(-1)};
    for(const [,key,value]of text.matchAll(/([\w-]+)="([^"]*)"/g))attributes[key]=value;
    if(name==='g'){stack.push(attributes);continue;}
    if(!['path','ellipse','circle','rect'].includes(name))throw new Error(`Unsupported coach garment primitive: ${name}`);
    if(name==='path')attributes.d=expandedPath(coachId,attributes.d);
    shapes.push({name,...attributes});
  }
  scenes.set(coachId,shapes);return shapes;
}

/** Draw complete fabric onto a clipped torso, then paint original wings above it. */
export function drawCoachGarment(context, coachId) {
  context.save();
  for(const shape of garmentScene(coachId)){
    const numeric=name=>Number(shape[name]||0);
    const ink=shape.name==='path'?new Path2D(shape.d):new Path2D();
    if(shape.name==='circle'){ink.arc(numeric('cx'),numeric('cy'),numeric('r'),0,Math.PI*2);ink.closePath();}
    if(shape.name==='ellipse'){ink.ellipse(numeric('cx'),numeric('cy'),numeric('rx'),numeric('ry'),0,0,Math.PI*2);ink.closePath();}
    if(shape.name==='rect'){
      const x=numeric('x'),y=numeric('y'),width=numeric('width'),height=numeric('height'),r=Math.min(numeric('rx'),width/2,height/2);
      ink.moveTo(x+r,y);ink.lineTo(x+width-r,y);ink.quadraticCurveTo(x+width,y,x+width,y+r);ink.lineTo(x+width,y+height-r);ink.quadraticCurveTo(x+width,y+height,x+width-r,y+height);ink.lineTo(x+r,y+height);ink.quadraticCurveTo(x,y+height,x,y+height-r);ink.lineTo(x,y+r);ink.quadraticCurveTo(x,y,x+r,y);ink.closePath();
    }
    if(shape.fill!=='none'){context.fillStyle=shape.fill||'#000';context.fill(ink);}
    if(shape.stroke&&shape.stroke!=='none'){
      context.strokeStyle=shape.stroke;context.lineWidth=Number(shape['stroke-width']||1);
      context.lineJoin=shape['stroke-linejoin']||'miter';context.lineCap=shape['stroke-linecap']||'butt';context.stroke(ink);
    }
  }
  context.restore();
}
