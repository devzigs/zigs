// Adapted from devzigs/zigs-site main 876e358; AGPL-3.0-only.
// Original presentation artwork. These diagrams contain no wallet or payment data.
const text=(x,y,value,{small=false,bright=false,fit=false,anchor='middle'}={})=>`<text x="${x}" y="${y}" text-anchor="${anchor}" class="xp-label${small?' xp-small':''}${bright?' xp-bright':''}${fit?' xp-fit':''}">${value}</text>`;
const wire=(d,{dashed=false,bright=false}={})=>`<path d="${d}" fill="none" stroke="${bright?'#a3a3a3':'#505050'}" stroke-width="1.5"${dashed?' stroke-dasharray="5 7"':''}/>`;
const arrow=(x1,y1,x2,y2,{dashed=false}={})=>wire(`M${x1} ${y1}H${x2-9}M${x2-17} ${y2-7}l8 7-8 7`,{dashed});
const down=(x,y1,y2)=>wire(`M${x} ${y1}V${y2}m-7-8 7 8 7-8`);
const panel=(id,x,y,w,h,body,{rounded=12,bright=false}={})=>`<g transform="translate(${x} ${y})"><rect x="4" y="7" width="${w}" height="${h}" rx="${rounded}" fill="#060606" stroke="#232323"/><rect width="${w}" height="${h}" rx="${rounded}" fill="url(#${id}-surface)" stroke="${bright?'#8a8a8a':'#4c4c4c'}"/><path d="M15 5H${w-15}" stroke="#727272" stroke-opacity=".5"/>${body}</g>`;
const bars=(x,y,w=100,count=3)=>Array.from({length:count},(_,i)=>`<path d="M${x} ${y+i*14}h${w-(i%2)*w*.22}" stroke="${i===1?'#8c8c8c':'#4f4f4f'}" stroke-width="3"/>`).join('');
const lock=(x,y,scale=1)=>`<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="#c3c3c3" stroke-width="2"><path d="M-13-4v-13a13 13 0 0 1 26 0v13"/><rect x="-21" y="-4" width="42" height="34" rx="6" fill="#131313"/><circle cy="10" r="3"/><path d="M0 13v6"/></g>`;
const key=(x,y,scale=1)=>`<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="#bcbcbc" stroke-width="2"><circle cx="-11" r="12"/><path d="M1 0h33v9h-9v8h-9V7H1"/></g>`;
const check=(x,y)=>`<g transform="translate(${x} ${y})"><circle r="13" fill="#171717" stroke="#777"/><path d="m-6 0 4 4 8-9" fill="none" stroke="#d5d5d5" stroke-width="2"/></g>`;
const phone=(id,x,y,title,kind='share')=>panel(id,x,y,130,205,`${text(65,32,title,{small:true})}${wire('M19 49H111')}${kind==='message'?`${bars(27,79,76,4)}${lock(65,147,.65)}`:kind==='read'?`${bars(27,78,76,3)}${check(65,145)}`:`${key(63,101,.8)}${text(65,164,'LOCAL SHARE',{small:true})}`}${wire('M48 189H82')}`,{rounded:15});
const heading=value=>text(400,44,value,{small:true});
const foot=value=>text(400,482,value,{small:true});
const preview=()=>`${heading('DESIGN PREVIEW')}${text(400,79,'Planned swap experience',{bright:true})}`;

const scenes={
 chains:id=>`${heading('ONE GROUP · TWO SEPARATE CHAIN KEYS')}
  ${[155,335,515].map((x,i)=>panel(id,x,82,130,111,`${text(65,30,'SEAT 0'+(i+1),{small:true})}${key(61,69,.7)}`)).join('')}
  ${wire('M220 200v42h360v-42M400 200v42M400 242v34M400 276H230v25M400 276h170v25')}
  ${panel(id,70,307,300,132,`${text(150,35,'Zcash key',{bright:true})}${key(68,79,.75)}${text(182,74,'Separate shares')}${text(182,101,'Zcash Testnet',{small:true})}`)}
  ${panel(id,430,307,300,132,`${text(150,35,'Solana key',{bright:true})}${key(68,79,.75)}${text(182,74,'Separate shares')}${text(182,101,'Solana Devnet',{small:true})}`)}
  ${foot('THE SAME SEATS · CHAIN-SPECIFIC AUTHORIZATION')}`,

 zcash:id=>`${heading('ZCASH · SHIELDED DETAILS ON A PUBLIC CHAIN')}
  ${[105,300,495].map((x,i)=>`${i<2?wire(`M${x+150} 127h45`):''}${panel(id,x,85,150,80,`${text(75,35,'PUBLIC BLOCK',{small:true,fit:true})}${bars(32,55,86,1)}`)}`).join('')}
  ${down(400,180,211)}
  ${panel(id,70,227,395,207,`${text(197,35,'Shielded payment',{bright:true})}${wire('M24 54H371')}${text(29,91,'Recipient',{anchor:'start'})}${bars(170,85,175,1)}${text(29,130,'Amount',{anchor:'start'})}${bars(170,124,132,1)}${text(197,183,'Encrypted details',{small:true})}${lock(345,168,.55)}`,{bright:true})}
  ${panel(id,511,249,218,155,`${text(109,34,'Visible footprint',{bright:true})}${text(109,78,'Timing · fees')}${text(109,111,'Transaction structure',{small:true,fit:true})}`)}
  ${foot('WALLET MEMBERS STILL HAVE SHARED VIEWING ACCESS')}`,

 scan:id=>`${heading('DOWNLOAD COMPACT BLOCKS · RECOGNIZE NOTES LOCALLY')}
  ${[65,245,425,605].map(x=>panel(id,x,89,130,78,`${bars(23,27,83,3)}`)).join('')}
  ${wire('M130 178v28h540v-28M310 178v28M490 178v28')}${down(400,206,237)}
  ${panel(id,155,252,490,183,`${text(245,29,'Your device',{small:true})}${wire('M19 44H471')}${panel(id,24,63,130,92,`${key(57,32,.6)}${text(65,73,'VIEWING KEY',{small:true,fit:true})}`)}${[187,282,377].map((x,i)=>`<rect x="${x}" y="70" width="67" height="78" rx="7" fill="#111" stroke="${i===1?'#acacac':'#3f3f3f'}"/>${bars(x+15,91,37,3)}${i===1?check(x+51,135):''}`).join('')}`)}
  ${foot('VIEWING KEY STAYS LOCAL · SERVICE CAN OBSERVE REQUEST METADATA')}`,

 zolana:id=>`${heading('ZOLANA · CONFIDENTIAL AMOUNTS, PUBLIC CONNECTIONS')}
  ${panel(id,50,145,190,213,`${text(95,34,'Deposit',{bright:true})}<circle cx="95" cy="96" r="35" fill="#111" stroke="#8b8b8b"/>${text(95,103,'SOL',{bright:true})}${text(95,161,'Public amount')}${text(95,190,'Into the pool',{small:true})}`)}
  ${arrow(250,251,294,251)}
  ${panel(id,302,145,196,213,`${text(98,34,'Pool payment',{bright:true})}${lock(98,89,1.05)}${text(98,161,'Hidden amount')}${text(98,190,'Confidential transfer',{small:true,fit:true})}`,{bright:true})}
  ${arrow(510,251,554,251)}
  ${panel(id,562,145,188,213,`${text(94,34,'Withdrawal',{bright:true})}<circle cx="94" cy="96" r="35" fill="#111" stroke="#8b8b8b"/>${text(94,103,'SOL',{bright:true})}${text(94,161,'Public amount')}${text(94,190,'Out of the pool',{small:true})}`)}
  ${text(400,411,'Group accounts · payee identifiers · fee activity',{bright:true})}
  ${foot('PUBLIC IDENTIFIERS AND TIMING CAN CONNECT ACTIVITY')}`,

 prover:id=>`${heading('DEFAULT SOLANA FLOW · HOSTED PROVER TRUST')}
  ${panel(id,65,126,242,237,`${text(121,36,'Your device',{bright:true})}${key(117,93,.9)}${text(121,158,'Private witness')}${text(121,187,'Input to the proof',{small:true})}`)}
  ${arrow(320,247,474,247)}${text(399,218,'Witness data',{small:true})}
  ${panel(id,485,126,250,237,`${text(125,36,'Hosted prover',{bright:true})}${[77,112,147].map(y=>`<rect x="45" y="${y}" width="160" height="24" rx="4" fill="#111" stroke="#555"/><circle cx="188" cy="${y+12}" r="3" fill="#aaa"/>`).join('')}${text(125,207,'Receives private data',{small:true})}`)}
  ${wire('M85 404H715',{dashed:true})}${text(400,440,'Public identifiers &amp; fee activity remain outside the proof')}
  ${foot('CONFIDENTIAL AMOUNTS DO NOT MAKE THE WHOLE TRANSACTION ANONYMOUS')}`,

 compose:id=>`${heading('COMPOSE · SIGN LOCALLY · ENCRYPT FOR THE ROOM')}
  <g class="xp-flow-compose-local">${panel(id,65,112,305,290,`${text(152,36,'Message on your device',{bright:true})}${wire('M23 56H282')}${bars(30,87,236,5)}${wire('M23 171H282')}${key(58,211,.65)}${text(183,211,'Local signature')}${text(152,260,'Bound to a seat key',{small:true})}`)}</g>
  ${arrow(384,260,477,260)}
  <g class="xp-flow-compose-sealed">${panel(id,487,164,245,182,`<path d="m11 13 111 77 111-77M11 166l75-69m148 69-75-69" fill="none" stroke="#5e5e5e"/>${lock(122,76,.95)}${text(122,153,'Encrypted content',{small:true})}`,{bright:true})}</g>
  ${text(607,394,'Ready for the relay')}
  ${foot('MESSAGE SIGNATURES DO NOT REPLACE WALLET APPROVALS')}`,

 relay:id=>`${heading('SEALED CONTENT BETWEEN MEMBER DEVICES')}
  ${phone(id,55,127,'SENDER','message')}${phone(id,615,127,'READER','message')}
  ${arrow(198,231,285,231)}${arrow(515,231,602,231)}
  ${panel(id,297,162,206,139,`${text(103,31,'Group relay',{bright:true})}${lock(103,69,.65)}${text(103,119,'Ciphertext',{small:true})}`)}
  ${wire('M400 314v38',{dashed:true})}
  ${panel(id,151,365,498,70,`${text(249,24,'OBSERVABLE METADATA',{small:true})}${text(249,57,'Identifiers · timing · IP · padded sizes')}`)}
  ${foot('THE RELAY HOLDS NO SPENDING SHARE')}`,

 read:id=>`${heading('OPEN THE MESSAGE · VERIFY THE PINNED KEY')}
  ${panel(id,145,92,510,297,`${text(255,35,'Readable by room members',{bright:true})}${wire('M25 56H485')}${bars(36,87,406,5)}${wire('M25 174H485')}${check(53,215)}${text(88,211,'Pinned seat key verified',{anchor:'start',bright:true})}${text(88,240,'Signature continuity checked',{anchor:'start',small:true})}`)}
  ${key(260,438,.6)}${text(455,442,'A key is not a real-world identity')}
  ${foot('VERIFY THE PERSON THROUGH AN INDEPENDENT CHANNEL')}`,

 retention:id=>`${heading('ENCRYPTED CONVERSATIONS · LASTING RESPONSIBILITIES')}
  ${panel(id,60,105,310,83,`${key(47,39,.65)}${text(192,37,'Room secret',{bright:true})}${text(192,63,'If exposed later',{small:true})}`)}
  ${down(215,200,242)}
  ${panel(id,60,257,310,155,`${text(155,32,'Recorded ciphertext',{bright:true})}${bars(32,60,243,3)}${text(155,125,'Past content can be read')}`)}
  ${panel(id,430,105,310,83,`${text(155,37,'Recipient memo',{bright:true})}${text(155,63,'Part of a Zcash transaction',{small:true})}`)}
  ${down(585,200,242)}
  ${panel(id,430,257,310,155,`${[65,130,195].map(x=>`<rect x="${x}" y="35" width="50" height="44" rx="4" fill="#111" stroke="#707070"/>${x<195?wire(`M${x+50} 57h15`):''}`).join('')}${text(155,125,'On-chain record is permanent')}`)}
  ${foot('CHATS ARE NOT FORWARD SECRET · MEMOS HAVE DIFFERENT PERSISTENCE')}`,

 'swap-route':id=>`${preview()}
  ${panel(id,60,172,192,192,`<circle cx="96" cy="68" r="37" fill="#111" stroke="#929292"/>${text(96,76,'Ƶ',{bright:true})}${text(96,137,'Zcash',{bright:true})}${text(96,165,'Shielded source',{small:true})}`)}
  ${arrow(266,265,306,265,{dashed:true})}
  ${panel(id,319,196,162,144,`${text(81,37,'Swap route',{bright:true})}${wire('M30 72h101m-9-7 9 7-9 7',{dashed:true})}${text(81,114,'PLANNED',{small:true})}`)}
  ${arrow(495,265,535,265,{dashed:true})}
  ${panel(id,548,172,192,192,`<circle cx="96" cy="68" r="37" fill="#111" stroke="#929292"/>${text(96,75,'SOL',{bright:true})}${text(96,137,'Solana',{bright:true})}${text(96,165,'Destination chain',{small:true,fit:true})}`)}
  ${foot('CONCEPTUAL ROUTE · AVAILABILITY AND PRIVACY REQUIRE VERIFICATION')}`,

 'swap-review':id=>`${preview()}
  ${panel(id,158,108,484,310,`${text(242,38,'Review before approval',{bright:true})}${wire('M25 59H459')}${[['Quote','Receive estimate'],['Route','Chains &amp; providers'],['Fees','Complete cost'],['Destination','Address &amp; network']].map(([a,b],i)=>`${text(30,99+i*53,a,{anchor:'start'})}${text(449,99+i*53,b,{anchor:'end',small:true})}${i<3?wire(`M25 ${117+i*53}H459`):''}`).join('')}`)}
  ${foot('CONCEPTUAL CHECKS · A QUOTE IS NOT A COMPLETED SWAP')}`,

 'swap-settlement':id=>`${preview()}
  ${wire('M154 226H646',{dashed:true})}
  ${[150,400,650].map((x,i)=>`<circle cx="${x}" cy="226" r="36" fill="#111" stroke="${i===2?'#bcbcbc':'#626262'}" stroke-width="1.4"/>${i===2?`<path d="m${x-13} 226 9 9 18-21" fill="none" stroke="#d3d3d3" stroke-width="2"/>`:i===1?wire(`M${x-12} 230h24m-9-8 9 8-9 8`,{bright:true}):`<circle cx="${x}" cy="226" r="13" fill="none" stroke="#9a9a9a"/><path d="M${x} 217v10l7 4" fill="none" stroke="#9a9a9a"/>`}${text(x,302,['Pending','Broadcast','Confirmed'][i],{bright:true})}${text(x,332,['Awaiting the next step','Submitted to a chain','Chain confirmation'][i],{small:true})}`).join('')}
  ${panel(id,214,379,372,56,`${text(186,34,'Illustrative status · planned flow',{small:true})}`)}
  ${foot('SUBMISSION AND SETTLEMENT ARE DIFFERENT STATES')}`
};

/** Decorative, build-time diagrams for the additional How it works flows. */
export function flowArtwork(scene,phase=''){
 const render=scenes[scene];
 if(!render)throw new RangeError(`Unknown flow artwork: ${scene}`);
 const id=`xp-flow-${scene}`;
 return `<svg xmlns="http://www.w3.org/2000/svg" class="xp-art xp-flow-art xp-flow-${scene}${phase?` xp-flow-phase-${phase}`:''}" viewBox="0 0 800 520" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}-surface" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#242424"/><stop offset=".4" stop-color="#151515"/><stop offset="1" stop-color="#090909"/></linearGradient><radialGradient id="${id}-light"><stop stop-color="#aaa" stop-opacity=".07"/><stop offset="1" stop-color="#aaa" stop-opacity="0"/></radialGradient></defs><ellipse cx="400" cy="255" rx="354" ry="228" fill="url(#${id}-light)"/>${render(id)}</svg>`;
}
