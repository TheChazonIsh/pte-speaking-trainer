// ==========================================
// 1. Configuration & Storage Keys
// ==========================================
export const STORAGE_KEYS = {
  solved: 'pte_solved_ids',
  unsolvedFirst: 'pte_unsolved_first',
  ttsAccent: 'pte_tts_accent',
  ttsVoiceUri: 'pte_tts_voice_uri',
  ttsRate: 'pte_tts_rate',
  useGeminiTts: 'pte_use_gemini_tts',
  geminiApiKey: 'pte_gemini_api_key',
  geminiModel: 'pte_gemini_model',
  bookmarks: 'pte_bookmarks',
  vocabList: 'pte_vocab_list',
  practiceLogs: 'pte_practice_logs',
  customRsQuestions: 'pte_custom_rs_questions',
  customDiQuestions: 'pte_custom_di_questions',
  ytClipSets: 'pte_rl_yt_clip_sets',
  ytShadowingSets: 'pte_yt_shadowing_sets',
  liveAcademySets: 'pte_live_academy_sets',
  liveAcademyProgress: 'pte_live_academy_progress',
  weaknessLogs: 'pte_weakness_logs',
  weaknessDrills: 'pte_weakness_drills'
};

export const DEFAULT_LIVE_ACADEMY_SETS = [
  {
    id: 'la-set-1',
    title: '영어 뇌 만들기 문장 5개',
    youtubeUrl: 'https://youtu.be/nyfJHf_skAU',
    createdAt: 1700000000001,
    nuanceComparisons: [
      {
        literal: 'I want to stop stressing over this.',
        native: "I'm tired of stressing over stuff like this.",
        noteKo: '단순히 "멈추고 싶다"가 아니라 감정적으로 지긋지긋하고 진절머리가 나는 피로감을 살리려면 be tired of ~ing를 씁니다.'
      },
      {
        literal: "It's my first time waiting this long.",
        native: "I've never waited this long for a food delivery.",
        noteKo: "It's my first time...은 긍정적 기대·설렘 뉘앙스인 반면, 부정적·극단적 첫 경험에는 I've never [p.p] this...를 씁니다."
      },
      {
        literal: 'She only worked for 10 years.',
        native: 'She did nothing but work for almost 10 years.',
        noteKo: 'only worked for 10 years는 "고작 10년 일했다"로 오해될 수 있고, 다른 건 안 하고 일만 했다는 뜻은 did nothing but [동사원형]입니다.'
      },
      {
        literal: 'save money',
        native: 'have money saved up',
        noteKo: 'save money는 돈을 모으는 행위 자체이고, 현재 시점에 모아둔 여유 자금이 있는 상태는 have money saved up으로 표현합니다.'
      }
    ],
    items: [
      {
        id: 'la1-q1',
        pattern: "I'm tired of ~ing",
        kr: '이런 일로 그만 좀 스트레스 받고 싶다.',
        en: "I'm (just so) tired of stressing over stuff like this.",
        variants: ["I'm tired of dealing with stuff like this."]
      },
      {
        id: 'la1-q2',
        pattern: "I've never [p.p] this [adj/adv]",
        kr: '음식 배달을 이렇게 오래 기다려 보는 건 처음이네.',
        en: "I've never waited this long for a food delivery.",
        variants: [
          "This is the longest I've ever waited for a food delivery.",
          "I've never had a food delivery take this long."
        ]
      },
      {
        id: 'la1-q3',
        pattern: 'do nothing but [verb]',
        kr: '걔 졸업하고 거의 10년 동안 딴 거 안 하고 계속 일만 했어.',
        en: 'She did nothing but work for almost 10 years after she graduated.',
        variants: []
      },
      {
        id: 'la1-q4',
        pattern: 'have money saved up',
        kr: '걔가 모아놓은 돈이 있는지 모르겠네.',
        en: "I don't know if she has any money saved up.",
        variants: []
      },
      {
        id: 'la1-q5',
        pattern: 'commit (to something)',
        kr: '나 이번에는 제대로 마음 잡고 살 빼려고.',
        en: "I'm really gonna commit this time and get in (better) shape.",
        variants: ["I'm really gonna commit to losing weight this time."]
      }
    ],
    makeYourOwnPrompts: [
      {
        id: 'la1-myo-1',
        pattern: "I'm tired of ~ing",
        promptKo: '내가 요즘 지긋지긋한 것 영작하기'
      },
      {
        id: 'la1-myo-2',
        pattern: "I've never [p.p] this [형용사]",
        promptKo: '최근 겪은 극단적인 상황 영작하기'
      },
      {
        id: 'la1-myo-3',
        pattern: 'do nothing but ~',
        promptKo: '주말에 한 일 영작하기'
      }
    ]
  },
  {
    id: 'la-set-2',
    title: 'PART 6 : 영어 뇌 만들기 문장 10개',
    youtubeUrl: 'https://youtu.be/j5QXDsW-Yf0',
    createdAt: 1700000000002,
    nuanceComparisons: [
      {
        literal: 'study well in school',
        native: 'do well in school / get good grades',
        noteKo: '한국어 "공부 잘했다"의 직역인 study well 대신, 성적·학업을 잘해냈다는 자연스러운 표현은 do well in school입니다.'
      },
      {
        literal: 'get lost on our way here',
        native: 'take a wrong turn on our way here',
        noteKo: 'get lost는 완전히 길을 잃어 헤매는 느낌이고, 내비게이션을 보다가 잠깐 한 번 잘못 들어선 경우는 take a wrong turn을 씁니다.'
      },
      {
        literal: "I wasn't there for a few days.",
        native: 'I was there for only a few days.',
        noteKo: '직역 부정문(wasn\'t there)은 "며칠 동안 거기에 없었다"라는 반대 뜻이 됩니다. 긍정문 + only a few days로 짧았음을 말하세요.'
      },
      {
        literal: "I didn't mean to say that.",
        native: "I didn't mean to say it like that. / That came out wrong.",
        noteKo: "didn't mean to say that은 내용 자체를 말할 의도가 아니었다는 뜻이고, 말투/표현이 잘못 나갔을 때는 like that / came out wrong을 씁니다."
      }
    ],
    items: [
      {
        id: 'la2-q1',
        pattern: "You haven't already left, have you?",
        kr: '야, 너 벌써 출발한 건 아니지?',
        en: "You haven't already left, have you?",
        variants: ["You're not already on your way, are you?"]
      },
      {
        id: 'la2-q2',
        pattern: 'a well-made movie',
        kr: '정말 잘 만든 영화야.',
        en: "It's a very well-made movie.",
        variants: []
      },
      {
        id: 'la2-q3',
        pattern: "You're gonna hurt somebody (like that)",
        kr: '야 너 그러다가 누구 다쳐.',
        en: "Hey, you're gonna hurt somebody (like that).",
        variants: []
      },
      {
        id: 'la2-q4',
        pattern: 'do well in school',
        kr: '걔 학교 때 의외로 공부 잘했어.',
        en: 'She did surprisingly well in school.',
        variants: ['She got surprisingly good grades in school.']
      },
      {
        id: 'la2-q5',
        pattern: 'take a wrong turn',
        kr: '우리 오는 길에 길을 한번 잘못 들었어.',
        en: 'We took a wrong turn on our way here.',
        variants: []
      },
      {
        id: 'la2-q6',
        pattern: 'for only a few days',
        kr: '나 거기 며칠 안 있었어.',
        en: 'I was there for only a few days.',
        variants: []
      },
      {
        id: 'la2-q7',
        pattern: 'do a thorough job',
        kr: '그분들이 일을 아주 꼼꼼하게 잘해 주셨더라고요.',
        en: 'They did a very thorough job.',
        variants: []
      },
      {
        id: 'la2-q8',
        pattern: 'say something stupid',
        kr: '아 너 지난번처럼 말 실수하면 안 된다.',
        en: 'You better not say anything stupid like last time.',
        variants: []
      },
      {
        id: 'la2-q9',
        pattern: 'that came out wrong',
        kr: '미안 말이 잘못 나왔어.',
        en: 'Sorry, that came out wrong.',
        variants: ["I didn't mean to say it like that."]
      },
      {
        id: 'la2-q10',
        pattern: 'more than we originally talked about',
        kr: '잠깐만요, 처음에 얘기했던 것보다 금액이 크잖아요.',
        en: 'Wait, this is more than we originally talked about.',
        variants: []
      }
    ],
    makeYourOwnPrompts: [
      {
        id: 'la2-myo-1',
        pattern: 'do a thorough job / do well in ~',
        promptKo: '일이나 학업에서 꼼꼼하게 해낸 경험 영작하기'
      },
      {
        id: 'la2-myo-2',
        pattern: 'take a wrong turn',
        promptKo: '운전·이동 중 길을 잘못 들었던 상황 영작하기'
      },
      {
        id: 'la2-myo-3',
        pattern: 'that came out wrong',
        promptKo: '말실수 후 뉘앙스를 바로잡는 문장 영작하기'
      }
    ]
  }
];

export const DEFAULT_YT_SHADOWING_SETS = [
  {
    id: 'yts-default-neural',
    title: '[샘플] AI Neural Networks & Practical Phrases — 12문장 실전 쉐도잉',
    videoId: 'aircAruvnKk',
    url: 'https://www.youtube.com/watch?v=aircAruvnKk',
    createdAt: 1700000000000,
    sentences: [
      {
        startSec: 15,
        endSec: 21,
        situationTag: '상황묘사',
        enText: 'Here is a three, written negligently on a very low-resolution grid of pixels.',
        koMeaning: '매우 낮은 해상도의 픽셀 격자 위에 대충 쓰인 숫자 3이 여기 있습니다.',
        stressAndLinkingTip: 'written negligently의 [n] 연음과 low-resolution의 첫 강세에 집중하세요.'
      },
      {
        startSec: 21,
        endSec: 27,
        situationTag: '일상설명',
        enText: 'Your brain has no trouble recognizing it as a three.',
        koMeaning: '여러분의 뇌는 이것을 숫자 3으로 인식하는 데 아무런 어려움이 없습니다.',
        stressAndLinkingTip: 'recognizing it as a three를 "레커그나이징-잇-애즈-어 뜨리"처럼 자연스럽게 이어 읽으세요.'
      },
      {
        startSec: 31,
        endSec: 38,
        situationTag: '의견제시',
        enText: 'Even though the specific pixel values are completely different every time.',
        koMeaning: '매번 구체적인 픽셀 값들이 완전히 다른데도 말입니다.',
        stressAndLinkingTip: 'Even though에서 살짝 띄고, completely different의 강한 강세를 살려주세요.'
      },
      {
        startSec: 44,
        endSec: 51,
        situationTag: '핵심요약',
        enText: 'Inside a neural network, each neuron simply holds a number between zero and one.',
        koMeaning: '신경망 내부에서 각 뉴런은 단순히 0과 1 사이의 숫자를 담고 있습니다.',
        stressAndLinkingTip: 'holds a number (홀즈-어 넘버) 연음과 zero and one 리듬을 유지하세요.'
      },
      {
        startSec: 53,
        endSec: 60,
        situationTag: '수치전달',
        enText: 'Twenty-eight by twenty-eight pixels add up to seven hundred eighty-four neurons.',
        koMeaning: '가로세로 28픽셀을 모두 합치면 총 784개의 입력 뉴런이 됩니다.',
        stressAndLinkingTip: '숫자 단위(twenty-eight, seven hundred eighty-four)를 또렷하고 끊어 읽지 않게 연습하세요.'
      },
      {
        startSec: 72,
        endSec: 78,
        situationTag: '개념설명',
        enText: 'Those first-layer neurons light up depending on how bright each pixel is.',
        koMeaning: '첫 번째 층의 뉴런들은 각 픽셀이 얼마나 밝은지에 따라 켜집니다.',
        stressAndLinkingTip: 'light up (라잇 업) 플랩 사운드와 depending on 연결 발음을 살려보세요.'
      },
      {
        startSec: 84,
        endSec: 90,
        situationTag: '과정설명',
        enText: 'Activations in one layer determine the activations in the very next layer.',
        koMeaning: '한 층에서의 활성화가 바로 다음 층의 활성화를 결정합니다.',
        stressAndLinkingTip: 'determine의 두 번째 음절 강세와 very next layer의 억양 하강에 주의하세요.'
      },
      {
        startSec: 112,
        endSec: 118,
        situationTag: '질문제시',
        enText: 'Why do we place multiple hidden layers in between the input and output?',
        koMeaning: '왜 입력과 출력 사이에 여러 개의 은닉층을 배치하는 걸까요?',
        stressAndLinkingTip: 'Why do we에서 리듬감 있게 올라간 뒤 multiple에 강세를 두세요.'
      },
      {
        startSec: 131,
        endSec: 138,
        situationTag: '논리연결',
        enText: 'Ideally, the hidden layers break down complex shapes into smaller components.',
        koMeaning: '이상적으로는 은닉층들이 복잡한 형태를 더 작은 구성 요소들로 분해합니다.',
        stressAndLinkingTip: 'Ideally 뒤에 짧은 호흡(pause), break down complex shapes를 한 호흡에 연결하세요.'
      },
      {
        startSec: 141,
        endSec: 148,
        situationTag: '핵심강조',
        enText: 'Recognizing tiny edges helps the system generalize across unfamiliar images.',
        koMeaning: '작은 모서리들을 인식하면 시스템이 낯선 이미지에서도 일반화할 수 있습니다.',
        stressAndLinkingTip: 'unfamiliar(언퍼밀리어) 강세와 across_unfamiliar 연음을 주의하세요.'
      },
      {
        startSec: 155,
        endSec: 162,
        situationTag: '일상비유',
        enText: 'It works a lot like how we group small letters together to read full words.',
        koMeaning: '마치 우리가 작은 글자들을 묶어 완전한 단어를 읽는 방식과 매우 비슷합니다.',
        stressAndLinkingTip: 'works a lot like를 뭉치지 말고 경쾌하게 이어 읽으세요.'
      },
      {
        startSec: 170,
        endSec: 177,
        situationTag: '정리제안',
        enText: 'Let us take a closer look at how those weighted connections are actually learned.',
        koMeaning: '이제 가중치가 부여된 연결들이 실제로 어떻게 학습되는지 자세히 살펴봅시다.',
        stressAndLinkingTip: 'take a closer look at how를 한 호흡으로 매끄럽게 연결하세요.'
      }
    ]
  }
];

export const ROLEPLAY_PRESETS = [
  {
    id: 'ece-interview',
    badge: '취업 면접',
    badgeCls: 'bg-indigo-100 text-indigo-800',
    title: '(1) ECE 유치원 취업 면접 (Interview)',
    partnerName: 'Centre Manager (Sarah)',
    partnerVoiceHint: 'Warm Auckland ECE Centre Manager interviewing an early childhood teacher candidate',
    contextEn: 'Job interview at an early childhood education (ECE) centre in Auckland, New Zealand. Discuss Te Whāriki curriculum, relationships with tamariki and whānau, behaviour guidance, and teamwork.',
    openingEn: "Kia ora! Thanks so much for coming in today. Before we show you around the centre, could you tell me a bit about your ECE background and what draws you to teaching here in New Zealand?",
    openingKo: '안녕하세요! 오늘 면접에 와주셔서 감사합니다. 센터를 둘러보기 전에 유아교육 경력과 뉴질랜드에서 가르치고 싶으신 이유를 간단히 말씀해 주실래요?'
  },
  {
    id: 'parent-talk',
    badge: 'ECE 학부모',
    badgeCls: 'bg-emerald-100 text-emerald-800',
    title: '(2) 학부모와의 아이 하루 일과 브리핑 (Parent Talk)',
    partnerName: 'Kiwi Parent (Hannah)',
    partnerVoiceHint: 'Friendly Kiwi mother picking up her 3-year-old child at afternoon pick-up time',
    contextEn: 'Afternoon pick-up talk between an ECE kaiako (teacher) and a New Zealand parent about how their child Mia ate, slept, played with friends, and explored activities today.',
    openingEn: "Hey there! Sorry I'm running a couple of minutes late—the traffic on the motorway was a bit crazy. How did Mia get on today? Did she manage to have a good rest and eat her lunch?",
    openingKo: '안녕하세요! 고속도로가 막혀서 몇 분 늦어서 죄송해요. 오늘 미아는 어떻게 지냈나요? 낮잠도 잘 자고 점심도 잘 먹었나요?'
  },
  {
    id: 'pharmacy',
    badge: '생활·약국',
    badgeCls: 'bg-sky-100 text-sky-800',
    title: '(3) 오클랜드 약국에서 증상 설명 및 약 구매',
    partnerName: 'Auckland Pharmacist (David)',
    partnerVoiceHint: 'Helpful community pharmacist at a chemist in Auckland',
    contextEn: 'Customer visiting an Auckland pharmacy to explain cold, sore throat, fever, or allergy symptoms, discuss symptom duration and medication allergies, and buy suitable over-the-counter medicine.',
    openingEn: "Hi there, welcome in! How can I help you today? Are you looking for something for yourself or for someone else in your family?",
    openingKo: '어서 오세요! 무엇을 도와드릴까요? 본인 증상 때문에 약을 찾으시나요, 아니면 가족분 약을 찾으시나요?'
  },
  {
    id: 'gp-clinic',
    badge: '병원·GP',
    badgeCls: 'bg-rose-100 text-rose-800',
    title: '(4) 병원/GP 전화 예약 및 증상 설명',
    partnerName: 'GP Clinic Receptionist (Emma)',
    partnerVoiceHint: 'Polite medical receptionist at a local New Zealand GP clinic',
    contextEn: 'Phone call to a New Zealand family doctor (GP) clinic to book an appointment, confirm patient enrollment/DOB, briefly explain symptoms and urgency, and agree on a time slot.',
    openingEn: "Good morning, Harbour Medical Centre, Emma speaking. Are you an enrolled patient with us, and how can I help you today?",
    openingKo: '좋은 아침입니다, 하버 메디컬 센터 엠마입니다. 저희 클리닉 등록 환자분이신가요? 오늘 어떤 진료로 연락주셨나요?'
  },
  {
    id: 'small-talk',
    badge: '일상 스몰토크',
    badgeCls: 'bg-amber-100 text-amber-800',
    title: '(5) 카페·이웃과의 스몰토크',
    partnerName: 'Kiwi Barista / Neighbour (Sam)',
    partnerVoiceHint: 'Cheerful Kiwi local barista or neighbour making friendly casual morning conversation',
    contextEn: 'Natural casual New Zealand small talk at a local Auckland café or with a friendly neighbour chatting about weather, coffee order (flat white), weekend plans, or local events.',
    openingEn: "Morning! How's your week going so far? Pretty breezy out there today, isn't it? What can I get started for you this morning?",
    openingKo: '좋은 아침이에요! 이번 주 어떻게 보내고 계신가요? 오늘 바람이 꽤 쌀쌀하죠? 오늘 아침엔 어떤 음료로 준비해 드릴까요?'
  },
  {
    id: 'custom',
    badge: '자유 주제',
    badgeCls: 'bg-indigo-100 text-indigo-800',
    title: '(6) 자유 주제 (직접 상황 입력)',
    partnerName: 'AI Conversation Partner',
    partnerVoiceHint: 'Adaptable New Zealand English conversation partner matching user custom scenario',
    contextEn: 'User-defined real-life New Zealand conversation scenario.',
    openingEn: "Kia ora! Let's jump right into your chosen situation. Tell me how you'd like to start, or ask me your first question!",
    openingKo: '안녕하세요! 설정하신 상황으로 바로 대화를 시작해 볼게요. 먼저 인사를 건네거나 첫 질문을 말씀해 보세요!'
  }
];

export const DEFAULT_YT_CLIP_SETS = [
  {
    id: 'yt-sample-neural',
    title: '[샘플] AI Neural Networks & Deep Learning Lecture (YouTube)',
    videoId: 'aircAruvnKk',
    url: 'https://www.youtube.com/watch?v=aircAruvnKk',
    overallSummary: '인간의 시각 피질이 손글씨 숫자를 인식하는 원리와 인공 신경망의 뉴런·가중치·층(Layer) 구조를 설명하는 대표적인 MIT/3Blue1Brown 스타일 강의입니다.',
    createdAt: 1700000000000,
    clips: [
      {
        id: 'YT-1',
        title: 'Clip 1 · Neurons as Information Holders',
        startSec: 15,
        endSec: 70,
        script: 'Imagine looking at a handwritten number three written carelessly on a small grid of pixels. Even when every stroke varies dramatically from person to person, your visual cortex immediately recognizes it as a three. Inside a neural network, each neuron simply holds a number between zero and one representing pixel activation, and twenty-eight by twenty-eight pixels feed into seven hundred eighty-four input neurons.',
        keywords: ['Handwritten digits', 'Visual cortex', 'Neural network', 'Activation number', '784 input neurons', 'Pixel grid'],
        modelAnswer: 'This lecture clip explains how humans and neural networks process visual patterns such as handwritten digits. First, the speaker notes that our brain recognizes varied strokes effortlessly. Next, it is explained that artificial neurons simply store activation values between zero and one across a pixel grid.',
        translation: '사람의 뇌가 다양한 필체의 숫자를 즉시 인식하듯, 인공 신경망에서는 각 뉴런이 0과 1 사이의 활성화 숫자를 저장해 픽셀 정보를 입력받는다는 설명입니다.'
      },
      {
        id: 'YT-2',
        title: 'Clip 2 · Hidden Layers & Edge Detection',
        startSec: 130,
        endSec: 185,
        script: 'Why do we place multiple hidden layers between the input pixels and the final ten digit classifications? Ideally, the second layer detects tiny visual edges, while the following layer combines those edges into simple loops and vertical lines. By breaking complex shapes into hierarchical subcomponents, the network generalizes smoothly rather than memorizing raw images.',
        keywords: ['Hidden layers', 'Edge detection', 'Hierarchical patterns', 'Loops and lines', 'Generalization'],
        modelAnswer: 'This clip discusses the role of hidden layers in deep learning architectures. Initially, early hidden layers detect small edges in an image. Subsequently, deeper layers combine those edges into loops and structural components, allowing the system to recognize digits rather than memorizing pixels.',
        translation: '은닉층이 계층적으로 모서리(edge)에서 선·고리 패턴으로 조합하여 이미지를 일반화해 인식하는 원리를 설명하는 구간입니다.'
      },
      {
        id: 'YT-3',
        title: 'Clip 3 · Weights, Biases & Weighted Sums',
        startSec: 260,
        endSec: 315,
        script: 'To measure whether a neuron should light up for a particular pattern, we assign a weight to every incoming connection and compute a weighted sum. Positive weights respond to active lines in an edge, while negative weights suppress surrounding pixels. Adding a bias term determines how high that weighted sum must climb before the neuron meaningfully activates.',
        keywords: ['Weighted sum', 'Positive weights', 'Negative weights', 'Bias threshold', 'Neuron activation'],
        modelAnswer: 'This segment focuses on how weights and biases govern neuron activation inside a network. The lecturer highlights that positive weights emphasize target edges whereas negative weights suppress background noise. Finally, adding a bias sets the activation threshold for each neuron.',
        translation: '양·음의 가중치 합(weighted sum)과 편향(bias)이 뉴런이 언제 활성화될지 임계값을 결정한다는 핵심 메커니즘 설명입니다.'
      }
    ]
  }
];

export const MODE_CONFIG = {
  'read-aloud': {
    label: 'Read Aloud (지문 읽기)',
    prepSeconds: 35,
    speakSeconds: 40,
    instruction: '<strong>지시문:</strong> 화면의 지문을 눈으로 먼저 읽고 준비하세요. <strong>35초 준비 시간</strong>이 끝나면 <strong>삐(Beep) 소리</strong>와 함께 마이크가 켜지며, <strong>40초 동안</strong> 자연스럽고 또렷한 발음으로 지문을 읽으시면 됩니다.'
  },
  'describe-image': {
    label: 'Describe Image (이미지 묘사)',
    prepSeconds: 25,
    speakSeconds: 40,
    instruction: '<strong>지시문:</strong> 아래 차트/다이어그램의 핵심 수치, 최댓값/최솟값, 단계별 흐름을 파악하세요. <strong>25초 준비 시간</strong> 후 <strong>삐(Beep) 소리</strong>가 울리면 <strong>40초 동안</strong> 영어로 묘사하세요.'
  },
  'repeat-sentence': {
    label: 'Repeat Sentence (문장 따라 말하기)',
    prepSeconds: 3,
    speakSeconds: 15,
    instruction: '<strong>지시문:</strong> 원어민이 읽어주는 1개의 영어 문장을 집중해서 들으세요. 음성이 끝나면 <strong>3초 준비 시간</strong> 후 <strong>삐(Beep) 소리</strong>와 함께 <strong>15초 동안</strong> 들은 문장을 그대로 따라 말하세요.'
  },
  'retell-lecture': {
    label: 'Retell Lecture (강의 요약 말하기)',
    prepSeconds: 10,
    speakSeconds: 40,
    instruction: '<strong>지시문:</strong> 45~60초 분량의 아카데믹 강의를 들으며 아래 <strong>실시간 메모장</strong>에 핵심 키워드를 필기하세요. 강의가 끝나면 <strong>10초 준비</strong> → <strong>삐(Beep)</strong> → <strong>40초 동안</strong> 강의 내용을 요약해 말하세요.'
  },
  impromptu: {
    label: '1분 즉흥 말하기 (Impromptu Talk)',
    prepSeconds: 15,
    speakSeconds: 60,
    instruction: '<strong>지시문:</strong> 일상·뉴질랜드 생활·유아교육(ECE)·비즈니스 주제에 대해 <strong>15초 동안 아이디어를 구상</strong>한 뒤(건너뛰기 가능), <strong>삐(Beep) 소리</strong>와 함께 <strong>60초 동안</strong> 영어로 즉흥 답변하세요.'
  }
};

export const WRITING_CONFIG = {
  swt: {
    label: 'Summarize Written Text (SWT)',
    durationSeconds: 600,
    minWords: 5,
    maxWords: 75,
    instruction: '<strong>SWT 작성 지시문:</strong> 아래 지문의 핵심 내용을 <strong>5~75단어 이내의 단 한 문장(1 sentence)</strong>으로 요약하세요. 마침표(<code>.</code>)는 문장 끝에 한 번만 사용해야 합니다.'
  },
  essay: {
    label: 'Write Essay (에세이)',
    durationSeconds: 1200,
    minWords: 200,
    maxWords: 300,
    instruction: '<strong>Essay 작성 지시문:</strong> 주어진 논제에 대해 <strong>200~300단어</strong> 분량의 논리적인 영어 에세이(서론-본론1-본론2-결론)를 20분 안에 작성하세요.'
  }
};

export const NEURAL_REGEX = /natural|online|neural|google|enhanced|premium/i;
export const TTS_CACHE_MAX_ITEMS = 15;

export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
export const GEMINI_TTS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent';
export const GEMINI_TEXT_TIMEOUT_MS = 25000;
export const GEMINI_TTS_TIMEOUT_MS = 30000;

export const DI_COLOR_PALETTE = ['#0284c7', '#0d9488', '#4f46e5', '#f59e0b', '#ec4899', '#16a34a'];

export const DANGEROUS_OBJ_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
