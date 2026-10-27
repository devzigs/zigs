// Adapted from devzigs/zigs-site main 876e358; AGPL-3.0-only.
// Website explainers, adapted from the reviewed documentation in chapters.mjs.
// These are educational flows, with no wallet or execution integration.
export const flows = [
 {
  id:'setup',label:'Setup',summary:'From first share to recovery',icon:'setup',
  title:'Create together. Move together.',
  description:'Four steps to understand shared control, from creating your wallet to recovering a seat.',
  steps:[
   {id:'create',title:'Create',copy:'Your devices make separate signing shares. No complete spending key is assembled in the ordinary shared-wallet flow.',caption:'Separate shares. One agreed public key.',art:'create',docs:'key-generation',link:'Read about creation'},
   {id:'verify',title:'Verify',copy:'Compare all 30 safety-number digits on every participating device, using an independent channel. Keep invitation links private.',caption:'Compare the complete safety number.',art:'verify',docs:'key-generation',link:'Compare safety numbers'},
   {id:'approve',title:'Approve',copy:'Each honest approving device checks the actual payment. Enough distinct shares authorize it; the chain must still confirm it.',caption:'Independent checks. Shared authorization.',art:'approve',docs:'payments',link:'Understand approvals'},
   {id:'recover',title:'Recover',copy:'An encrypted backup restores one seat. Keep its passphrase separate and enough distinct shares recoverable for your rule.',caption:'Restore the same identity. Preserve the rule.',art:'recover',docs:'recovery',link:'Explore recovery'}
  ]
 },
 {
  id:'signers',label:'Signers',summary:'One group, separate chain keys',icon:'signers',
  title:'Separate shares. One signing group.',
  description:'Set up distinct seats, then use your group on Zcash Testnet and Solana Devnet with separate keys for each chain.',
  steps:[
   {id:'group',title:'Choose your group',copy:'Invite the people or devices that will hold distinct signing seats. Compare all 30 safety-number digits on every device over an independent channel.',caption:'Independent devices. Distinct signing identities.',art:'verify',docs:'key-generation',link:'Set up your signers'},
   {id:'keys',title:'Separate the keys',copy:'Each seat keeps its own signing share. The same group can control Zcash and the Solana beta, with a separate key ceremony and cryptographic state for each chain.',caption:'The same seats. Separate Zcash and Solana keys.',art:'chains',docs:'solana',link:'Understand the two chains'},
   {id:'review',title:'Review together',copy:'Approving devices inspect the actual payment before signing. Enough distinct seats must approve under the wallet’s chosen rule. Two copies of one seat still count as one signer.',caption:'Same payment. Enough distinct shares.',art:'approve',docs:'payments',link:'Follow a payment approval'},
   {id:'execute',title:'Sign on each chain',copy:'Zcash combines signature shares, proves locally and broadcasts. Solana submits the group signature and proof through its approvals program. Both still need chain confirmation.',caption:'The relay holds no spending share. Solana programs have external upgrade authorities.',art:'chains',docs:'solana',link:'Read about Solana execution'}
  ]
 },
 {
  id:'zcash-zolana',label:'Zcash & Solana',summary:'How privacy differs on each',icon:'privacy',
  title:'Two chains. Different privacy.',
  description:'Shielded Zcash and Zolana’s pool on Solana Devnet protect different information. Follow the boundaries of each.',
  steps:[
   {id:'shield',title:'Shield on Zcash',copy:'Supported Zcash recipients and amounts stay encrypted on the public chain. Wallet members can still read their shared activity. Timing, fees, expiry and action counts remain public.',caption:'Shielded payment details. A visible transaction footprint.',art:'zcash',docs:'privacy',link:'Explore Zcash privacy'},
   {id:'local',title:'Keep the view local',copy:'Your browser generates Zcash proofs and recognizes notes in downloaded compact blocks. The viewing key stays on the device. Services can still observe request ranges, timing and IP information.',caption:'Fetching full transactions for memos reveals transactions of interest.',art:'scan',docs:'receiving-sync',link:'Understand local scanning'},
   {id:'pool',title:'Move through Zolana',copy:'Zolana’s private pool transfers hide their amount on Solana Devnet. Owner identifiers, the group PDA and fee-paying addresses remain linkable. Deposits and withdrawals expose amounts.',caption:'A confidential amount does not make the whole transaction anonymous.',art:'zolana',docs:'solana',link:'See the Solana privacy model'},
   {id:'proving',title:'Know who proves',copy:'The default hosted Solana prover receives private spend witnesses. A separate local-proving mode keeps proving on group devices, while public identifiers and external program authorities remain.',caption:'Local proving cannot erase witness data already shared.',art:'prover',docs:'solana',link:'Compare proving modes'}
  ]
 },
 {
  id:'secure-messaging',label:'Secure Messaging',summary:'From your device to theirs',icon:'messaging',
  title:'Write privately. Verify the sender.',
  description:'Follow an encrypted off-chain conversation from the sender’s device to its intended readers.',
  steps:[
   {id:'conversation',title:'Choose your room',copy:'Coordinate with members in a wallet room, or use a separate direct chat for one contact. Each conversation has its own encryption secret. Keep full contact links private: they can unlock chat content.',caption:'A wallet room and a direct chat use different secrets.',art:'compose',docs:'messaging',link:'Choose a messaging channel'},
   {id:'seal',title:'Sign, then seal',copy:'Your device signs the message with its local identity key and encrypts the content before sending it to the relay. A message signature is separate from a shared wallet’s payment approval.',caption:'Signed on the device. Encrypted before transport.',art:'compose',docs:'messaging',link:'Understand message signatures'},
   {id:'transport',title:'Send it encrypted',copy:'The relay carries sealed conversation data. Readers need the conversation secret to decrypt it. Identifiers, connection timing, IP addresses, counts and padded sizes remain observable.',caption:'Sealed content. Observable metadata.',art:'relay',docs:'privacy',link:'See what the relay can learn'},
   {id:'read',title:'Read and verify',copy:'The receiving device decrypts the message and checks its signature against the pinned sender key. Confirm a new contact through another channel. Chats are not forward secret: a leaked secret can expose recorded older messages.',caption:'Key continuity is verified. Readers can still copy what they see.',art:'read',docs:'messaging',link:'Read the messaging boundaries'}
  ]
 },
 {
  id:'private-swaps',label:'Private Swaps',summary:'A look at the planned journey',icon:'swaps',status:'Preview · Unavailable',
  title:'Explore a possible private swap.',
  description:'A preview of a possible cross-chain journey. The current implementation does not execute swaps.',
  steps:[
   {id:'pair',title:'Choose a pair',copy:'The concept begins by choosing the asset to exchange and the asset to receive. Sharing one interface does not itself exchange Zcash and SOL.',caption:'Illustrative selection. No live swap is created.',art:'swap-route',docs:'solana',link:'Understand the chain boundaries'},
   {id:'route',title:'Review the route',copy:'A future swap would need a supported route, quoted amount, fees and clear expiry conditions before the group commits funds. No live quote, liquidity or route is verified in this preview.',caption:'A planned route, with costs and conditions to review.',art:'swap-review',docs:'trust-limits',link:'Read the trust assumptions'},
   {id:'authorize',title:'Approve the payment',copy:'A proposed swap would still need the source wallet’s required distinct signers. Each approving device would inspect the actual payment. This illustration does not collect approvals or authorize a swap.',caption:'Design preview. The source wallet’s approval rule would still apply.',art:'create',docs:'payments',link:'Understand shared authorization'},
   {id:'settle',title:'Verify the result',copy:'A source payment alone would not prove that a swap finished. A future flow would need to verify destination receipt and explain recovery if the route fails. Cross-chain privacy, settlement and refund guarantees are not established here.',caption:'Design preview. Destination receipt must be checked separately.',art:'swap-settlement',docs:'trust-limits',link:'Explore the remaining boundaries'}
  ]
 }
];
