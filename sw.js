/* ============================================================
   Service Worker — おやすみ / おはよう
   役割：
   1. アプリファイルをキャッシュ → オフライン動作
   2. アラームをsetTimeout/setIntervalで監視
      → ブラウザがバックグラウンドでも通知を送信
      → アプリが開いていればpostMessageで音を鳴らす
============================================================ */

const CACHE = 'oyasumi-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

/* ---- インストール：アセットをキャッシュ ---- */
self.addEventListener('install', e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
});

/* ---- アクティベート：古いキャッシュを削除 ---- */
self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>
      Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))
    ).then(()=>self.clients.claim())
  );
});

/* ---- フェッチ：キャッシュ優先 ---- */
self.addEventListener('fetch', e=>{
  // chrome-extension や非HTTPリクエストはスキップ
  if(!e.request.url.startsWith('http')) return;
  e.respondWith(
    caches.match(e.request).then(cached=>{
      if(cached) return cached;
      return fetch(e.request).then(res=>{
        // 成功したレスポンスをキャッシュに追加
        if(res && res.status===200 && res.type==='basic'){
          const clone = res.clone();
          caches.open(CACHE).then(c=>c.put(e.request, clone));
        }
        return res;
      }).catch(()=>cached); // オフライン時はキャッシュにフォールバック
    })
  );
});

/* ============================================================
   アラーム管理
   メインスレッドから SET_ALARMS メッセージを受け取り、
   毎分チェックして時刻が一致したら通知＋postMessage
============================================================ */
let alarms = []; // [{id, time, label}]
let alarmCheckTimer = null;

self.addEventListener('message', e=>{
  if(e.data?.type === 'SET_ALARMS'){
    alarms = e.data.alarms || [];
    startAlarmCheck();
  }
});

function startAlarmCheck(){
  // 既存タイマーをリセット
  if(alarmCheckTimer) clearInterval(alarmCheckTimer);
  if(alarms.length === 0) return;

  alarmCheckTimer = setInterval(checkAlarms, 10000); // 10秒ごとにチェック
  checkAlarms(); // 即時も実行
}

function checkAlarms(){
  if(alarms.length === 0) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const ss = now.getSeconds();
  // 毎分0〜15秒の間だけ発火（10秒ごとのポーリングと合わせて確実に捕捉）
  if(ss > 15) return;

  alarms.forEach(alarm=>{
    if(alarm.time === hh+':'+mm){
      fireAlarm(alarm);
    }
  });
}

async function fireAlarm(alarm){
  // 1) アプリが開いているならpostMessageで音を鳴らす
  const clients = await self.clients.matchAll({type:'window', includeUncontrolled:true});
  if(clients.length > 0){
    clients.forEach(c=>c.postMessage({type:'ALARM_TRIGGER', id:alarm.id}));
  }

  // 2) OS通知を送る（バックグラウンドでも有効）
  if(self.registration.showNotification){
    await self.registration.showNotification('⏰ おはようございます', {
      body: alarm.label ? `「${alarm.label}」の時間です` : '起きる時間です',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: `alarm-${alarm.id}`,
      renotify: true,
      requireInteraction: true, // タップするまで消えない
      vibrate: [300, 100, 300, 100, 500],
      actions: [
        {action:'stop', title:'止める'},
        {action:'snooze', title:'あと5分'},
      ]
    });
  }
}

/* ---- 通知アクション処理 ---- */
self.addEventListener('notificationclick', e=>{
  e.notification.close();
  if(e.action === 'snooze'){
    // スヌーズ：5分後に再通知
    const alarm = alarms.find(a=>`alarm-${a.id}` === e.notification.tag);
    if(alarm){
      setTimeout(()=>fireAlarm(alarm), 5*60*1000);
    }
  }
  // アプリを前面に出す
  e.waitUntil(
    self.clients.matchAll({type:'window'}).then(clients=>{
      if(clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
