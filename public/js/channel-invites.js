// Only invitations on this messenger origin may bypass external-link confirmation.
export function channelInviteToken(value,origin){
 try{const url=new URL(value,origin);if(url.origin!==origin||url.username||url.password)return null;return url.pathname.match(/^\/join\/([A-Za-z0-9_-]{8,32})\/?$/)?.[1]||null;}catch{return null;}
}
