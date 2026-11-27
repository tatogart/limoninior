// Offline topic expansion. It never uploads private text or claims image recognition.
const GROUPS=[['еда','обед','ужин','завтрак','кафе','ресторан','пицца','поесть'],['учеба','учёба','школа','урок','домашка','задание','экзамен'],['работа','задача','проект','дедлайн','срок','отчет','отчёт'],['поездка','путешествие','отпуск','билет','самолет','самолёт','поезд','отель'],['встреча','увидеться','прогулка','погулять','завтра','договориться'],['деньги','оплата','перевод','цена','купить','рублей','стоимость'],['игра','играть','катка','матч','турнир'],['фото','картинка','изображение','снимок','скриншот'],['файл','документ','pdf','таблица','архив']];
const fold=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/ё/g,'е');
const stem=s=>s.length>5?s.slice(0,Math.max(4,s.length-2)):s;
export function topicScore(query,message){
 const terms=fold(query).match(/[\p{L}\p{N}]+/gu)||[];if(!terms.length)return 0;
 let extra={};try{extra=JSON.parse(message.extra||'{}');}catch{}
 const text=fold(message.text+' '+(extra?.name||'')+' '+(message.kind==='image'?'фото изображение':'')+' '+(message.kind==='file'?'файл документ':''));
 let score=text.includes(fold(query))?12:0;
 for(const term of terms){const root=stem(term);if(text.includes(root))score+=6;
 for(const group of GROUPS)if(group.some(t=>stem(fold(t))===root)){if(group.some(t=>text.includes(stem(fold(t)))))score+=2;}}
 return score;
}
