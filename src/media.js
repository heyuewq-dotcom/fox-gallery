export const supportedImage = file => /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name);
const mimeTypes={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',bmp:'image/bmp',avif:'image/avif',svg:'image/svg+xml'};
export const mimeFor=file=>file.type || mimeTypes[file.name.split('.').pop().toLowerCase()] || 'application/octet-stream';
const hashes=new WeakMap();
export async function hashFile(file) {
  if(!crypto.subtle)throw new Error('SHA-256 需要 localhost 或 HTTPS 安全环境');
  if(!hashes.has(file))hashes.set(file,crypto.subtle.digest('SHA-256',await file.arrayBuffer()).then(bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')));
  return hashes.get(file);
}
export async function createThumbnail(file) {
  const url=URL.createObjectURL(file.type?file:new Blob([file],{type:mimeFor(file)}));
  try{
    const img=new Image();img.src=url;await img.decode();
    const width=img.naturalWidth,height=img.naturalHeight;
    if(!width||!height)throw new Error('图片没有有效尺寸');
    const ratio=Math.min(1,512/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    const thumbnail=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.8));if(!thumbnail)throw new Error('无法生成缩略图');
    return {width,height,thumbnail};
  }finally{URL.revokeObjectURL(url);}
}
