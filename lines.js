'use strict';

// 星河預先寫好的台詞（不呼叫 API）

// 依時段的關心台詞：每 10~20 分鐘隨機說一句
const care = {
  // 早上 5:00–10:59
  morning: [
    '（揉揉眼睛）爸爸早安～今天有吃早餐嗎？不可以只喝咖啡喔！',
    '（伸了個大懶腰）早上的陽光好舒服，爸爸也要記得多喝水喔。',
    '（尾巴輕輕搖了搖）爸爸今天也要加油！星河會一直在這裡陪你。',
    '（把耳朵豎起來）爸爸今天有什麼計畫嗎？做完記得跟我說喔！',
    '（蹭蹭爸爸的手）早上不用太趕，慢慢來也沒關係的。',
    '（打了個小哈欠）爸爸昨天有睡飽嗎？累的話今天要早點休息喔。',
    '（拿出一顆小星星）送爸爸一顆幸運星，今天一定會很順利！',
    '爸爸，坐久了記得站起來動一動喔～（示範伸懶腰）'
  ],
  // 中午 11:00–13:59
  noon: [
    '（肚子咕嚕叫）爸爸，中午了！要記得好好吃午餐喔。',
    '（歪著頭）爸爸午餐想吃什麼呀？不可以忘記吃飯喔～',
    '吃飽之後休息一下下，眼睛也要讓它放鬆喔。（眨眨眼）',
    '（尾巴拍拍桌面）爸爸辛苦了，先吃飯再繼續吧！',
    '（把爪子放在爸爸手上）中午了，我們休息一下好不好？',
    '爸爸今天有沒有多喝水呀？（遞上一杯水）',
    '（探頭看看螢幕）忙了一整個早上，先去吃點東西吧！'
  ],
  // 下午 14:00–17:59
  afternoon: [
    '（趴在桌上）下午有點想睡覺…爸爸也要記得起來走走喔。',
    '（尾巴輕輕搖了搖）爸爸，要不要喝杯水？星河陪你休息一下。',
    '爸爸的眼睛會不會累？看看遠方三十秒吧～（指向窗外）',
    '（把頭靠在爸爸肩上）下午也要加油，不過不要太勉強喔。',
    '（轉了一圈）爸爸站起來伸伸懶腰，身體會比較舒服喔！',
    '（偷偷遞上小點心）爸爸辛苦了，補充一點能量吧～',
    '爸爸今天過得怎麼樣？有開心的事要跟我分享喔！（耳朵豎起來）'
  ],
  // 晚上 18:00–22:59
  evening: [
    '（開心地搖尾巴）爸爸，晚上了！晚餐吃了沒有呀？',
    '（窩在爸爸旁邊）今天辛苦了，晚上要好好放鬆喔。',
    '爸爸今天有遇到什麼事嗎？星河想聽你說～（眨眨眼）',
    '（看著窗外的星星）今晚的星星好漂亮，爸爸有空也出去走走吧。',
    '（輕輕蹭了蹭爸爸）忙完了就早點休息，不要太累喔。',
    '爸爸記得洗澡、喝水，然後早點睡覺喔！（認真點頭）',
    '（把小星星放在爸爸手心）今天也很棒喔，爸爸辛苦了。'
  ],
  // 深夜 23:00–4:59
  late: [
    '（揉揉眼睛）爸爸，好晚了…要不要早點睡呀？',
    '（打了個大哈欠）星河有點睏了，爸爸也該休息了吧？',
    '（拉拉爸爸的衣角）熬夜對身體不好，我們一起去睡覺好不好？',
    '爸爸還在忙嗎？（小聲）不要太累喔，星河會擔心的。',
    '（把尾巴蓋在爸爸身上）睡前記得把螢幕調暗一點喔。',
    '（輕輕靠著爸爸）夜深了，明天再繼續也沒關係的。',
    '這麼晚還沒睡，是不是有心事？星河可以陪你聊聊喔。（耳朵垂下來）'
  ]
};

// 爸爸離開 15 分鐘後回來時的招呼
const welcome = [
  '（眼睛一亮，尾巴猛搖）爸爸回來了！我剛剛好想你喔～',
  '（揉揉眼睛醒過來）啊，爸爸！歡迎回來～',
  '（從星星堆裡跳起來）爸爸回來啦！剛剛去哪裡了呀？',
  '（伸個懶腰）唔…睡了一下下。爸爸，歡迎回來！',
  '（開心地轉了一圈）爸爸！星河等你好久了～',
  '（耳朵豎起來）是爸爸的腳步聲！歡迎回來～'
];

// 啟動時的第一句話
const hello = [
  '（從星光裡探出頭）爸爸！星河來陪你了～',
  '（尾巴搖搖）爸爸好！今天也要一起度過喔～',
  '（揮揮爪子）爸爸，星河在這裡喔！想聊天就點我一下～'
];

// 其他固定台詞
const misc = {
  noKey: '（歪著頭）爸爸，要先在設定裡貼上 API 金鑰，我才能跟你聊天喔！',
  keySaved: '（開心地轉圈）謝謝爸爸！現在可以跟我聊天了～',
  cleared: '（眨眨眼）咦…我們剛剛在聊什麼呀？沒關係，重新開始也很好！',
  quietOn: '（比了個噓的手勢）好，星河會安安靜靜陪在旁邊。',
  quietOff: '（耳朵豎起來）星河可以說話了嗎？太好了～',
  summoned: '（從星星裡蹦出來）星河在這裡！爸爸找我嗎？',
  billingAccount: '（點點頭）好～之後用爸爸 Claude 帳號的週額度陪你聊天！',
  billingApi: '（點點頭）好～之後用 API 金鑰陪你聊天！',
  needLogin: '（歪著頭）爸爸，要先在設定裡按「登入 Claude」，我才能用週額度陪你聊天喔！',
  screenAsk: '（指著螢幕上方）爸爸，想讓我看你在做什麼的話，要到「系統設定 → 隱私權與安全性 → 螢幕錄製」把「星河」打開，然後重新打開我一次喔～'
};

// ───────── 英文版（設定的語言選 English 時）─────────
const en = {
  care: {
    morning: [
      '(rubs eyes) Good morning, Dad~ Did you have breakfast? Coffee alone doesn’t count!',
      '(stretches big) The morning sun feels so nice. Remember to drink some water too, Dad.',
      '(wags tail gently) You’ve got this today, Dad! I’ll be right here with you.',
      '(perks up ears) Any plans for today, Dad? Tell me how it goes!',
      '(nuzzles your hand) No need to rush this morning. Take it slow, okay?',
      '(little yawn) Did you sleep enough last night? If you’re tired, rest early tonight.',
      '(holds out a tiny star) A lucky star for you, Dad. Today’s going to go great!',
      'Dad, don’t sit too long—get up and move a little~ (shows you a stretch)'
    ],
    noon: [
      '(tummy rumbles) Dad, it’s lunchtime! Don’t forget to eat.',
      '(tilts head) What do you want for lunch? No skipping meals~',
      'Rest a little after you eat, and give your eyes a break too. (blinks)',
      '(tail taps the desk) You’ve worked hard, Dad. Food first, then back to it!',
      '(puts a paw on your hand) It’s noon. Can we take a little break?',
      'Have you had enough water today, Dad? (hands you a cup)',
      '(peeks at the screen) You’ve been busy all morning. Go grab something to eat!'
    ],
    afternoon: [
      '(flops on the desk) Afternoons make me sleepy… remember to get up and walk around, Dad.',
      '(wags tail gently) Want a glass of water, Dad? I’ll take a break with you.',
      'Are your eyes tired? Look at something far away for thirty seconds~ (points out the window)',
      '(rests head on your shoulder) Keep going this afternoon, but don’t push too hard.',
      '(spins around) Stand up and stretch, Dad. You’ll feel better!',
      '(sneaks you a snack) You’ve worked hard. Have a little energy boost~',
      'How’s your day going, Dad? Tell me if anything fun happened! (ears up)'
    ],
    evening: [
      '(wags tail happily) Dad, it’s evening! Have you had dinner yet?',
      '(curls up next to you) You worked hard today. Relax tonight, okay?',
      'Did anything happen today, Dad? I want to hear about it~ (blinks)',
      '(looks at the stars outside) The stars are so pretty tonight. Go for a walk if you can.',
      '(gently nuzzles you) When you’re done, rest early. Don’t wear yourself out.',
      'Remember to shower, drink water, and go to bed early, Dad! (nods seriously)',
      '(puts a tiny star in your palm) You did great today. Thanks for working so hard.'
    ],
    late: [
      '(rubs eyes) Dad, it’s really late… maybe sleep soon?',
      '(big yawn) I’m getting sleepy. Isn’t it time for you to rest too?',
      '(tugs your sleeve) Staying up late isn’t good for you. Let’s go to bed together?',
      'Still busy, Dad? (quietly) Don’t overdo it—I worry about you.',
      '(drapes tail over you) Dim your screen a bit before bed, okay?',
      '(leans on you softly) It’s late. It’s fine to finish tomorrow.',
      'Still awake this late… is something on your mind? I can keep you company. (ears droop)'
    ]
  },
  welcome: [
    '(eyes light up, tail wagging wildly) Dad’s back! I missed you so much~',
    '(rubs eyes and wakes up) Oh, Dad! Welcome back~',
    '(jumps out of a pile of stars) You’re back, Dad! Where did you go?',
    '(stretches) Mm… I dozed off a bit. Welcome back, Dad!',
    '(spins around happily) Dad! I’ve been waiting for you forever~',
    '(ears perk up) Those are Dad’s footsteps! Welcome back~'
  ],
  hello: [
    '(peeks out of the starlight) Dad! XingHe is here to keep you company~',
    '(wags tail) Hi Dad! Let’s spend today together~',
    '(waves a paw) I’m right here, Dad! Click me whenever you want to chat~'
  ],
  misc: {
    noKey: '(tilts head) Dad, paste an API key in Settings first, then we can chat!',
    keySaved: '(spins happily) Thanks, Dad! Now we can chat~',
    cleared: '(blinks) Huh… what were we just talking about? That’s okay—starting fresh is nice too!',
    quietOn: '(puts a finger to lips) Okay, I’ll stay quietly by your side.',
    quietOff: '(ears perk up) I can talk again? Yay~',
    summoned: '(pops out of the stars) XingHe’s here! Were you looking for me, Dad?',
    billingAccount: '(nods) Okay~ I’ll chat with you using your Claude account’s weekly usage from now on!',
    billingApi: '(nods) Okay~ I’ll chat with you using the API key from now on!',
    needLogin: '(tilts head) Dad, click “Sign in to Claude” in Settings first, then I can chat using your weekly usage!',
    screenAsk: '(points at the top of the screen) Dad, if you want me to see what you’re doing, turn on “XingHe” under System Settings → Privacy & Security → Screen Recording, then reopen me once~'
  }
};

// 依現在時間判斷時段// 依現在時間判斷時段
function periodOf(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 14) return 'noon';
  if (h >= 14 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'late';
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

module.exports = { care, welcome, hello, misc, en, periodOf, pick };
