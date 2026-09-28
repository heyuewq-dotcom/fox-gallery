export const SCHEMA_VERSION = 1;
export const HASH = /^[a-f0-9]{64}$/i;
export const emptyUser = () => ({favorite:false,tags:[],category:'',note:''});
export const parseTags = text => [...new Set(text.split(/[,，\n]/).map(t=>t.trim()).filter(Boolean))];
export const categoryOf = (image,user) => user?.category || image.category || '待识别';
export const isDuplicate = image => image.sources.length > 1 || Boolean(image.duplicateGroup);

export function normalizeRecord(row, context = {}) {
  if (!row || !HASH.test(row.sha256 || '')) throw new Error('缺少有效 SHA-256');
  if (typeof row.filename !== 'string' || !row.filename.trim()) throw new Error('缺少文件名');
  const sha256 = row.sha256.toLowerCase();
  const source = {filename:row.filename,path:row.filePath || row.original_rel || row.filename,origin:context.origin || row.source || 'manifest',batch:row.batch || ''};
  return {
    id:sha256,sha256,filename:row.filename,originalName:row.originalName || row.filename,
    width:Number(row.width) || 0,height:Number(row.height) || 0,fileSize:Number(row.fileSize ?? row.size_bytes) || 0,
    mimeType:row.mimeType || '',source:source.origin,category:typeof row.category === 'string' ? row.category : '',
    createdAt:row.createdAt || '',importedAt:new Date().toISOString(),
    duplicateGroup:row.duplicateGroup || row.duplicate_group || '',
    thumbnail:context.thumbnail || '',sources:[source],metadata:{...row}
  };
}

export function mergeImage(previous, next) {
  if (!previous) return next;
  const key = s => JSON.stringify([s.origin,s.path,s.batch]);
  const sources = new Map(previous.sources.map(s=>[key(s),s]));
  for (const s of next.sources) sources.set(key(s),s);
  return {...previous,...next,importedAt:previous.importedAt,thumbnail:next.thumbnail || previous.thumbnail,
    duplicateGroup:next.duplicateGroup || previous.duplicateGroup,sources:[...sources.values()],
    metadata:{...previous.metadata,...next.metadata}};
}

export function filterImages(images, users, {query='',category='',filter='all'} = {}) {
  const q = query.trim().toLocaleLowerCase();
  return images.filter(image => {
    const user = users.get(image.sha256) || emptyUser();
    if (category && categoryOf(image,user) !== category) return false;
    if (filter === 'favorite' && !user.favorite) return false;
    if (filter === 'duplicate' && !isDuplicate(image)) return false;
    const text = [image.filename,image.sha256,categoryOf(image,user),user.note,...user.tags,...image.sources.map(s=>s.filename)].join(' ').toLocaleLowerCase();
    return !q || text.includes(q);
  });
}
