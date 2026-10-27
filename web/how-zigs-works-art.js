// Adapted from devzigs/zigs-site main 876e358; AGPL-3.0-only.
// Original, synthetic documentation artwork. No wallet state or external assets.
// Animation changes emphasis only: every concept remains visible without motion.
const label=(x,y,value,cls='')=>`<text x="${x}" y="${y}" text-anchor="middle" class="dxa-label ${cls}">${value}</text>`;
const wire=(d,cls='')=>`<path d="${d}" class="dxa-wire ${cls}"/>`;
const flow=(d,phase='a')=>wire(d)+`<path d="${d}" pathLength="100" class="dxa-flow dxa-flow-${phase}"/>`;
const check=(x,y,cls='')=>`<g class="dxa-check ${cls}" transform="translate(${x} ${y})"><circle r="11"/><path d="m-4.5 0 3 3 6-7"/></g>`;
const shadow=(x,y,rx=55,ry=10)=>`<ellipse class="dxa-floor" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>`;

function defs(id){return `<defs>
 <linearGradient id="${id}-metal" x1="0" y1="0" x2=".85" y2="1"><stop stop-color="#fafafa"/><stop offset=".19" stop-color="#9d9d9d"/><stop offset=".4" stop-color="#454545"/><stop offset=".57" stop-color="#a9a9a9"/><stop offset=".79" stop-color="#555"/><stop offset="1" stop-color="#b4b4b4"/></linearGradient>
 <linearGradient id="${id}-surface" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="#292929"/><stop offset=".32" stop-color="#161616"/><stop offset="1" stop-color="#090909"/></linearGradient>
 <linearGradient id="${id}-glass" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#373737" stop-opacity=".9"/><stop offset=".36" stop-color="#151515" stop-opacity=".96"/><stop offset="1" stop-color="#0b0b0b"/></linearGradient>
 <linearGradient id="${id}-side" x1="0" y1="0" x2="1" y2=".8"><stop stop-color="#555"/><stop offset=".35" stop-color="#272727"/><stop offset="1" stop-color="#0f0f0f"/></linearGradient>
 <linearGradient id="${id}-ink" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f0f0f0"/><stop offset=".48" stop-color="#8d8d8d"/><stop offset=".76" stop-color="#d3d3d3"/><stop offset="1" stop-color="#6c6c6c"/></linearGradient>
 <linearGradient id="${id}-beam"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
 <radialGradient id="${id}-light" cx=".5" cy=".4" r=".6"><stop stop-color="#ddd" stop-opacity=".075"/><stop offset="1" stop-color="#ddd" stop-opacity="0"/></radialGradient>
 <filter id="${id}-shadow" x="-50%" y="-40%" width="210%" height="220%"><feDropShadow dx="0" dy="13" stdDeviation="10" flood-color="#000" flood-opacity=".6"/></filter>
 <filter id="${id}-halo" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.2"/></filter>
 <clipPath id="${id}-scan-clip"><rect x="168" y="190" width="230" height="105" rx="5"/></clipPath>
 </defs>`;}

function device(id,x,y,{seat='',caption='',phase='a',muted=false,kind='share',scale=1}={}){
 const glyph=kind==='message'?'<path d="M-22-20h38v29H-6l-11 9V9h-5Z"/><path d="M-14-10h22M-14-2H2"/>':kind==='verified'?'<path d="m-17-3 10 10 22-25"/>':`<path d="M-20-18 0-28 20-18 0-8Z M-20-8 0 2l20-10M-20 2 0 12 20 2"/><path d="M0 14v10"/>`;
 return `<g class="dxa-device ${muted?'dxa-muted':''} dxa-phase-${phase}" transform="translate(${x} ${y}) scale(${scale})">
 ${shadow(2,90,52,8)}
 <g filter="url(#${id}-shadow)"><path d="M-45-66 32-75 45-62V63l-77 12-13-13Z" fill="url(#${id}-metal)"/><path d="m33-73 11 12V62L33 72Z" fill="url(#${id}-side)"/><path d="M-42-63 31-72V61l-73 10Z" fill="url(#${id}-surface)" stroke="#818181" stroke-width=".7"/>
 <path d="M-37-57 25-64" class="dxa-hairline"/><path d="M-30-48 18-54M-27 50l29-4" class="dxa-etch"/><path d="M-38 65 25 56" stroke="#080808" stroke-width="2"/>
 <g class="dxa-relief" stroke="url(#${id}-ink)" transform="translate(-4 -1)">${glyph}</g>
 ${seat?label(-5,39,seat,'dxa-tiny'):''}<path d="m-43-64 75-9 12 12" class="dxa-specular"/></g>
 </g>${caption?label(x,y+113*scale,caption,'dxa-small'):''}`;
}

function chip(id,x,y,{label:word='',phase='a',width=160,height=57}={}){
 return `<g class="dxa-chip dxa-phase-${phase}" transform="translate(${x} ${y})">
 <rect x="${-width/2+5}" y="${-height/2+7}" width="${width}" height="${height}" rx="11" fill="#080808" stroke="#292929"/>
 <rect x="${-width/2}" y="${-height/2}" width="${width}" height="${height}" rx="11" fill="url(#${id}-glass)" stroke="url(#${id}-metal)" stroke-width=".9"/>
 <path d="M${-width/2+14} ${-height/2+5}H${width/2-14}" class="dxa-specular"/>
 ${word?label(0,5,word,'dxa-bright'):''}</g>`;
}

function coin(id,x,y,word,cls=''){
 return `<g class="${cls}" transform="translate(${x} ${y})">${shadow(3,59,39,7)}<ellipse cx="5" cy="5" rx="39" ry="43" fill="url(#${id}-side)" stroke="#494949"/><ellipse rx="39" ry="43" fill="url(#${id}-metal)"/><ellipse rx="34" ry="38" fill="url(#${id}-surface)" stroke="#777" stroke-width=".7"/><ellipse rx="29" ry="33" fill="none" stroke="#454545" stroke-width=".65"/>${label(0,6,word,'dxa-coin-type')}<path d="M-27-26A35 38 0 0 1 16-34" class="dxa-specular"/></g>`;
}

function lock(id,x,y,{scale=1,phase='b'}={}){
 return `<g class="dxa-lock dxa-phase-${phase}" transform="translate(${x} ${y}) scale(${scale})"><path d="M-14-5v-15a14 14 0 0 1 28 0v15" fill="none" stroke="#080808" stroke-width="8"/><path d="M-14-5v-15a14 14 0 0 1 28 0v15" fill="none" stroke="url(#${id}-metal)" stroke-width="4.5"/><rect x="-24" y="-6" width="48" height="36" rx="7" fill="url(#${id}-metal)"/><rect x="-21" y="-3" width="42" height="29" rx="5" fill="url(#${id}-surface)"/><circle cy="10" r="3.7" fill="url(#${id}-ink)"/><path d="M0 13v5" stroke="#bbb" stroke-width="2"/></g>`;
}

function envelope(id,x,y,{scale=1,cls=''}={}){
 return `<g class="dxa-envelope ${cls}" transform="translate(${x} ${y}) scale(${scale})">${shadow(7,65,76,9)}
 <path d="m-76-45 146-9 13 12v87l-146 9-13-12Z" fill="url(#${id}-side)" stroke="#565656" stroke-width=".8"/>
 <path d="m-76-45 146-9v89l-146 9Z" fill="url(#${id}-glass)" stroke="url(#${id}-metal)" stroke-width="1"/>
 <path d="m-74-42 72 49 71-58" fill="url(#${id}-surface)" stroke="#777" stroke-width=".9"/>
 <path d="m-74 41 48-42M68 33 25-5" class="dxa-etch"/>
 <path d="m-70-43 137-9" class="dxa-specular"/>
 <circle cx="-2" cy="8" r="19" fill="#070707" stroke="#666"/><circle cx="-2" cy="7" r="16" fill="url(#${id}-surface)" stroke="url(#${id}-metal)"/>
 <path d="M-8 6V1a6 6 0 0 1 12 0v5M-10 6H6v12h-16Z" fill="none" stroke="url(#${id}-ink)" stroke-width="1.7" stroke-linejoin="round"/>
 </g>`;
}

const scenes={
 verify:id=>`${label(280,32,'COMPARE OVER AN INDEPENDENT CHANNEL','dxa-overline')}
 ${device(id,112,170,{seat:'DEVICE A',phase:'a',scale:.8})}
 ${device(id,448,170,{seat:'DEVICE B',phase:'c',scale:.8})}
 ${wire('M160 155h240M160 198h240','dxa-dashed')}
 ${label(280,154,'ALL 30 DIGITS','dxa-overline')}
 ${label(280,191,'Compare the full safety number','dxa-small')}
 ${check(280,260,'dxa-phase-b')}
 ${label(280,337,'CHECK EVERY PARTICIPATING DEVICE','dxa-overline')}
 ${label(280,376,'A short preview is not enough.','dxa-small')}`,

 custody:id=>`
 ${label(280,32,'THRESHOLD AUTHORIZATION','dxa-overline')}
 ${flow('M120 217v34q0 15 15 15h120q25 0 25 25v12','a')}
 ${flow('M280 217v86','b')}${wire('M440 217v34q0 15-15 15H315q-17 0-23 13','dxa-wire-muted dxa-dashed')}
 ${device(id,120,133,{seat:'SHARE 01',caption:'Seat 01',phase:'a'})}
 ${device(id,280,133,{seat:'SHARE 02',caption:'Seat 02',phase:'b'})}
 ${device(id,440,133,{seat:'SHARE 03',caption:'Seat 03',phase:'c',muted:true})}
 ${check(149,173,'dxa-phase-a')}${check(309,173,'dxa-phase-b')}
 ${chip(id,280,326,{width:228,label:'One group signature',phase:'c'})}
 ${check(184,326,'dxa-phase-c')}${label(280,380,'ANY 2 OF 3 · DISTINCT SIGNING SHARES','dxa-overline')}`,

 dkg:id=>`
 ${label(280,32,'DISTRIBUTED KEY GENERATION','dxa-overline')}
 ${wire('M112 207v28h336v-28M280 207v39','dxa-dashed')}
 ${flow('M112 225v10h168','a')}${flow('M448 225v10H280','b')}
 ${device(id,112,128,{seat:'SHARE A',caption:'Independent A',phase:'a',scale:.84})}
 ${device(id,280,128,{seat:'SHARE B',caption:'Independent B',phase:'b',scale:.84})}
 ${device(id,448,128,{seat:'SHARE C',caption:'Independent C',phase:'c',scale:.84})}
 ${label(280,257,'SEALED EXCHANGE','dxa-tiny')}
 <g class="dxa-phase-c" transform="translate(280 304)">${shadow(3,50,59,8)}<ellipse cx="4" cy="4" rx="49" ry="40" fill="url(#${id}-side)"/><ellipse rx="49" ry="40" fill="url(#${id}-metal)"/><ellipse rx="45" ry="36" fill="url(#${id}-surface)"/><g fill="none" stroke="url(#${id}-ink)" stroke-width="2" stroke-linejoin="round"><circle cx="-10" cy="-3" r="10"/><path d="m0-3 23 0 0 7-6 0v6h-7v-7H0"/></g><path d="M-34-26q27-18 59-1" class="dxa-specular"/></g>
 ${label(280,367,'SEPARATE SHARES · ONE AGREED PUBLIC KEY','dxa-overline')}`,

 device:id=>`
 ${label(280,33,'LOCAL DEVICE PROTECTION','dxa-overline')}
 ${flow('M132 195h58','a')}${flow('M375 195h47','c')}
 ${coin(id,95,195,'PRF','dxa-phase-a')}
 <g transform="translate(280 200)">${shadow(8,100,105,14)}
 <path d="m-98 16 98-48 98 48v62L0 126-98 78Z" fill="url(#${id}-side)" stroke="#414141"/><path d="m-98 16 98 48 98-48M0 64v62" class="dxa-etch"/>
 <g class="dxa-vault-middle"><path d="m-98-10 98-48 98 48v22L0 60-98 12Z" fill="url(#${id}-surface)" stroke="#626262"/><path d="m-98-10 98 48 98-48M0 38v22" class="dxa-etch"/><path d="m-23-12 23-12 23 12L0 0Z m-23 8 23 12L23 8" fill="none" stroke="url(#${id}-ink)" stroke-width="2"/></g>
 <g class="dxa-vault-lid"><path d="m-98-42 98-48 98 48v17L0 23-98-25Z" fill="url(#${id}-surface)" stroke="url(#${id}-metal)" stroke-width="1"/><path d="m-98-42 98 48 98-48M0 6v17" class="dxa-etch"/><path d="m-94-43 94-46 93 46" class="dxa-specular"/>${lock(id,0,-51,{scale:.65})}</g></g>
 ${device(id,457,195,{seat:'SHARE',phase:'c',scale:.68})}
 ${label(95,290,'Passkey','dxa-small')}${label(280,350,'Encrypted vault','dxa-small')}${label(457,290,'Local signing share','dxa-small')}
 ${label(280,382,'UNLOCK STORAGE · THE SHARE STILL SIGNS','dxa-overline')}`,

 sync:id=>`
 ${label(280,31,'COMPACT BLOCKS · SAME DOWNLOAD','dxa-overline')}
 ${[94,218,342,466].map((x,i)=>`<g class="dxa-block dxa-phase-${i%2?'b':'a'}" transform="translate(${x} 89)"><path d="M-35-24 26-30 35-22v43l-61 7-9-8Z" fill="url(#${id}-side)" stroke="#454545"/><path d="M-35-24 26-30v44l-61 7Z" fill="url(#${id}-surface)" stroke="url(#${id}-metal)" stroke-width=".7"/><path d="M-22-11h34m-34 9H3m-25 9h27" class="dxa-etch"/><circle cx="17" cy="-8" r="2" fill="#aaa"/></g>`).join('')}
 ${wire('M94 123v24h372v-24M218 123v24M342 123v24')}${flow('M280 147v23','a')}
 <g class="dxa-browser"><rect x="145" y="173" width="282" height="153" rx="12" fill="#0a0a0a" stroke="#292929"/><rect x="138" y="166" width="282" height="153" rx="12" fill="url(#${id}-surface)" stroke="url(#${id}-metal)" stroke-width="1"/>
 <path d="M139 194h280" stroke="#444" stroke-width=".8"/><path d="M153 171h250" class="dxa-specular"/>
 ${[153,163,173].map(x=>`<circle cx="${x}" cy="181" r="1.8" fill="#777"/>`).join('')}<path d="M225 181h112" class="dxa-etch"/>
 <g clip-path="url(#${id}-scan-clip)"><rect x="170" y="207" width="55" height="82" rx="5" fill="#0c0c0c" stroke="#454545"/><g fill="none" stroke="url(#${id}-ink)" stroke-width="1.6"><circle cx="192" cy="235" r="7"/><path d="M199 235h12v6h-5v5h-5v-5h-3"/></g>
 ${label(197,274,'VIEW KEY','dxa-tiny')}
 ${[248,302,356].map((x,i)=>`<g class="${i===1?'dxa-recognized dxa-phase-c':''}"><rect x="${x}" y="217" width="38" height="55" rx="5" fill="url(#${id}-glass)" stroke="${i===1?'#aaa':'#444'}"/><path d="M${x+9} 232h20M${x+9} 240h14M${x+9} 248h17" class="dxa-etch"/>${i===1?check(x+19,282,'dxa-phase-c'):''}</g>`).join('')}
 <rect class="dxa-scan-beam" x="169" y="196" width="85" height="108" fill="url(#${id}-beam)"/><path class="dxa-scan-line" d="M181 199v101" stroke="#ddd" stroke-width=".8" opacity=".45"/>
 </g></g>${label(280,354,'Match encrypted notes on the device','dxa-small')}${label(280,382,'THE VIEWING KEY STAYS LOCAL','dxa-overline')}`,

 payment:id=>`
 ${label(280,30,'ONE TRANSACTION · ONE DIGEST','dxa-overline')}
 ${flow('M209 139h-91q-13 0-13 13v34','a')}${flow('M351 139h91q13 0 13 13v34','a')}
 <g class="dxa-receipt dxa-phase-a" transform="translate(280 121)"><path d="m-78-57 147-8 12 12v122l-147 9-12-11Z" fill="url(#${id}-side)" stroke="#444"/><path d="m-78-57 147-8v123l-147 9Z" fill="url(#${id}-surface)" stroke="url(#${id}-metal)" stroke-width=".9"/><path d="m-69-51 127-7" class="dxa-specular"/>
 ${label(-4,-31,'PAYMENT DIGEST','dxa-tiny')}${[-15,8,31].map((y,i)=>`<path d="M-56 ${y} 45 ${y-6}" class="dxa-etch"/><path d="M-56 ${y+8} ${i===1?'6':'28'} ${y+3}" stroke="${i===1?'#ccc':'#777'}" stroke-width="2"/><path d="m43 ${y+4} 3 3 6-7" fill="none" stroke="#ccc" stroke-width="1.2"/>`).join('')}</g>
 ${device(id,105,233,{seat:'APPROVE A',phase:'b',scale:.66})}${device(id,455,233,{seat:'APPROVE B',phase:'b',scale:.66})}
 ${check(126,259,'dxa-phase-b')}${check(476,259,'dxa-phase-b')}
 ${flow('M105 291v20q0 13 13 13h76','b')}${flow('M455 291v20q0 13-13 13h-76','b')}
 ${chip(id,280,324,{width:172,label:'Group signature',phase:'c'})}
 ${flow('M280 353v11','c')}${label(280,385,'PROVE → BROADCAST → CHAIN CONFIRMATION','dxa-overline')}`,

 privacy:id=>`
 ${label(280,32,'SEALED CONTENT · VISIBLE CONNECTIONS','dxa-overline')}
 ${flow('M115 177h74','a')}${flow('M369 177h74','c')}
 ${device(id,83,177,{seat:'SENDER',phase:'a',scale:.72})}${device(id,477,177,{seat:'READER',phase:'c',scale:.72})}
 ${envelope(id,282,167,{scale:1.02,cls:'dxa-phase-b'})}
 <path d="M212 232v24h136v-24M280 256v25" class="dxa-wire dxa-dashed"/>
 <g class="dxa-metadata" transform="translate(280 316)"><rect x="-139" y="-31" width="278" height="62" rx="9" fill="#0b0b0b" stroke="#474747"/><path d="M-131-26h262" class="dxa-hairline"/>
 ${label(0,-9,'RELAY METADATA','dxa-tiny')}${label(0,15,'Wallet ID · timing · IP · size','dxa-small')}
 <circle cx="-122" cy="0" r="2" fill="#aaa"/><circle cx="122" cy="0" r="2" fill="#aaa"/></g>
 ${label(280,382,'ENCRYPTION DOES NOT HIDE THE ENVELOPE','dxa-overline')}`,

 solana:id=>`
 ${label(280,32,'SOLANA DEVNET · DIFFERENT BOUNDARIES','dxa-overline')}
 ${wire('M100 221v89h360v-89','dxa-dashed')}${flow('M100 310h91','a')}${flow('M369 310h91v-89','c')}
 ${coin(id,100,166,'SOL','dxa-phase-a')}${label(100,244,'Public fee payer','dxa-small')}
 <g class="dxa-pool" transform="translate(280 160)">${shadow(7,88,84,11)}
 <path d="m-78 16 78-39 78 39v34L0 89-78 50Z" fill="url(#${id}-side)" stroke="#444"/><path d="m-78 16 78 39 78-39M0 55v34" class="dxa-etch"/>
 <g class="dxa-pool-layer"><path d="m-78-9 78-39 78 39v20L0 50-78 11Z" fill="url(#${id}-surface)" stroke="url(#${id}-metal)" stroke-width=".8"/><path d="m-78-9 78 39L78-9M0 30v20" class="dxa-etch"/>${lock(id,0,-15,{scale:.6,phase:'b'})}</g></g>
 ${label(280,274,'Hidden payment amount','dxa-small')}
 ${flow('M359 165h59','c')}
 <g class="dxa-phase-c" transform="translate(460 166)"><rect x="-36" y="-45" width="76" height="88" rx="9" fill="url(#${id}-side)"/><rect x="-40" y="-49" width="76" height="88" rx="9" fill="url(#${id}-surface)" stroke="url(#${id}-metal)" stroke-width=".8"/><g fill="none" stroke="url(#${id}-ink)" stroke-width="1.7"><circle cx="-8" cy="-8" r="9"/><path d="M1-8h18v7h-6v6H6v-6H1"/></g><path d="M-27 21h45" class="dxa-etch"/></g>
 ${label(460,244,'Public payee key','dxa-small')}
 ${chip(id,280,310,{width:178,label:'Public group PDA',height:46,phase:'b'})}
 ${label(280,380,'PUBLIC IDENTIFIERS STILL LINK ACTIVITY','dxa-overline')}`,

 messages:id=>`
 ${label(280,31,'AUTHENTICATED CONVERSATION','dxa-overline')}
 ${flow('M133 155h70','a')}${flow('M357 155h70','c')}
 ${device(id,100,152,{kind:'message',seat:'ED25519',phase:'a',scale:.78})}
 ${device(id,460,152,{kind:'verified',seat:'PINNED KEY',phase:'c',scale:.78})}
 <g transform="translate(280 147)"><path d="m-67-52 130-8 8 7v77l-130 8-8-7Z" fill="#131313" stroke="#454545" transform="translate(3 -13)"/><path d="m-67-52 130-8 8 7v77l-130 8-8-7Z" fill="#171717" stroke="#555" transform="translate(-3 -5)"/></g>
 ${envelope(id,280,156,{scale:.82,cls:'dxa-phase-b'})}
 ${label(100,258,'Write &amp; sign','dxa-small')}${label(460,258,'Read &amp; verify','dxa-small')}
 ${flow('M280 215v46','b')}
 <g class="dxa-relay dxa-phase-b" transform="translate(280 297)"><rect x="-93" y="-25" width="190" height="52" rx="9" fill="#0a0a0a" stroke="#292929"/><rect x="-97" y="-29" width="190" height="52" rx="9" fill="url(#${id}-surface)" stroke="url(#${id}-metal)" stroke-width=".8"/>${label(-8,1,'Encrypted relay','dxa-small')}<circle cx="76" cy="-3" r="3" fill="#bdbdbd"/><path d="M-84-23H80" class="dxa-specular"/></g>
 ${check(460,288,'dxa-phase-c')}${label(280,381,'VERIFY A PINNED KEY · CHECK HUMAN IDENTITY SEPARATELY','dxa-overline')}`,

 recovery:id=>`
 ${label(280,32,'ONE SIGNING SEAT · RESTORED','dxa-overline')}
 ${flow('M137 166h72','a')}${flow('M351 166h72','c')}
 ${device(id,100,164,{seat:'SEAT 01',caption:'Original seat',phase:'a',scale:.78})}
 ${device(id,460,164,{seat:'SEAT 01',caption:'Same seat',phase:'c',scale:.78})}
 <g class="dxa-backup dxa-phase-a" transform="translate(280 147)">${shadow(7,79,51,9)}<path d="M-47-58 12-63 44-34v97l-83 8-8-8Z" fill="url(#${id}-side)" stroke="#494949"/><path d="M-47-58 12-63 38-37v94l-85 8Z" fill="url(#${id}-surface)" stroke="url(#${id}-metal)" stroke-width="1"/><path d="M12-63v28l26-2" fill="#272727" stroke="#777" stroke-width=".8"/><path d="M-34-50 4-53" class="dxa-specular"/>${lock(id,-5,4,{scale:.67})}<path d="M-29 42 20 37" class="dxa-etch"/></g>
 ${label(280,249,'.zigsbackup','dxa-small')}
 ${wire('M280 271v14','dxa-dashed')}
 <g class="dxa-passphrase dxa-phase-b" transform="translate(280 319)"><rect x="-97" y="-28" width="194" height="56" rx="10" fill="url(#${id}-surface)" stroke="#686868"/><path d="M-87-23H87" class="dxa-hairline"/>${[-53,-32,-11,10,31,52].map(x=>`<circle cx="${x}" cy="-7" r="2.4" fill="#b7b7b7"/>`).join('')}${label(0,15,'Separate passphrase','dxa-tiny')}</g>
 ${label(280,382,'THE SAME IDENTITY · ONE VOTE','dxa-overline')}`,

 trust:id=>`
 ${label(280,32,'INDEPENDENT CHECKS · DISTINCT BOUNDARIES','dxa-overline')}
 <path d="M280 63c51 29 94 30 120 36v87c0 69-60 111-120 137-60-26-120-68-120-137V99c26-6 69-7 120-36Z" fill="url(#${id}-light)" stroke="#252525" stroke-width=".8"/>
 ${wire('M111 246v28h338v-28','dxa-dashed')}
 ${[111,280,449].map((x,i)=>`<g class="dxa-station dxa-phase-${['a','b','c'][i]}" transform="translate(${x} 174)">${shadow(5,85,51,8)}<path d="m-55-61 102-9 11 11v120l-102 10-11-11Z" fill="url(#${id}-side)" stroke="#414141"/><path d="m-55-61 102-9V50l-102 10Z" fill="url(#${id}-surface)" stroke="url(#${id}-metal)" stroke-width=".85"/><path d="M-47-55 39-63" class="dxa-specular"/>
 ${i===0?`<g fill="#a4a4a4">${[0,1].map(col=>Array.from({length:5},(_,r)=>Array.from({length:3},(_,c)=>`<circle cx="${-33+col*36+c*6}" cy="${-26+r*8}" r="1.3"/>`).join('')).join('')).join('')}</g><path d="M-8-26V8" class="dxa-etch"/>`:i===1?`<g fill="none" stroke="url(#${id}-ink)" stroke-width="1.5"><path d="M-24-35H7l14 14v46h-45Z M7-35v14h14"/><path d="M-14-10H9M-14 0H5m-19 10H0"/><path d="m2 18 5 5 10-13"/></g>`:`<g fill="none" stroke="url(#${id}-ink)" stroke-width="1.6"><circle cy="-28" r="8"/><circle cx="-23" cy="12" r="8"/><circle cx="23" cy="12" r="8"/><path d="m-5-20-13 23M5-20 18 3M-15 12H15"/></g><path d="m-4-28 3 3 6-7m-26 44 3 3 6-7" class="dxa-check-stroke"/>`}
 ${label(-3,42,'0'+(i+1),'dxa-tiny')}</g>`).join('')}
 ${label(111,297,'Compare identity','dxa-small')}${label(280,297,'Inspect payment','dxa-small')}${label(449,297,'Require threshold','dxa-small')}
 ${[111,280,449].map((x,i)=>check(x,333,'dxa-phase-'+['a','b','c'][i])).join('')}
 ${label(280,382,'NO SINGLE CHECK REPLACES THE OTHERS','dxa-overline')}`,
};

/** Build-time SVG. Scene names match content/how-it-works/chapters.mjs. */
export function docsDiagramSvg(scene){
 const render=scenes[scene==='glossary'?'trust':scene];
 if(!render)throw new RangeError(`Unknown documentation diagram: ${scene}`);
 const id=`dxa-${scene}`;
 return `<svg xmlns="http://www.w3.org/2000/svg" class="dxa-art dxa-scene-${scene}" viewBox="0 0 560 400" aria-hidden="true" focusable="false" data-diagram-scene="${scene}">${defs(id)}<ellipse cx="280" cy="192" rx="259" ry="180" fill="url(#${id}-light)"/>${render(id)}</svg>`;
}
