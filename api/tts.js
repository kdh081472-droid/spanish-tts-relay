// Vercel 서버리스 함수: 브라우저 ↔ OpenAI 사이의 중계자.
// OpenAI 키를 여기 저장하지 않고, 매 요청마다 클라이언트가 실어 보낸 키를
// 그대로 OpenAI에 전달만 함. 응답에 CORS 허용 헤더를 붙여서 브라우저가
// 막지 않고 받을 수 있게 해줌. voice/speed도 클라이언트가 보낸 값을 그대로 전달.
const ALLOWED_VOICES = new Set([
  "alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "marin", "cedar",
]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 지원해요." });
    return;
  }

  const auth = req.headers.authorization || "";
  const apiKey = auth.replace(/^Bearer\s+/i, "").trim();
  if (!apiKey) {
    res.status(401).json({ error: "API 키가 없어요. Authorization 헤더로 보내주세요." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  const text = ((body && body.text) || "").toString().slice(0, 2000);
  if (!text.trim()) {
    res.status(400).json({ error: "읽을 텍스트가 없어요." });
    return;
  }

  const voiceIn = ((body && body.voice) || "nova").toString();
  const voice = ALLOWED_VOICES.has(voiceIn) ? voiceIn : "nova";

  let speed = Number(body && body.speed);
  if (!Number.isFinite(speed)) speed = 1.0;
  speed = Math.max(0.25, Math.min(4.0, speed));

  // 짧은 문장일수록 일부 목소리(특히 nova/shimmer)에서 시작 부분이 잘려 들리는
  // 증상이 있어서(OpenAI 쪽 알려진 문제), 맨 앞에 마침표+공백을 항상 붙여서 보냄 — 커뮤니티에서
  // 확인된 우회법. 스페인어는 ¡/¿로 시작하는 경우가 많은데 그것만으론 보호가 안 돼서,
  // 이미 마침표로 시작하는 경우만 빼고는 항상 붙임.
  const spokenText = text.startsWith(". ") ? text : `. ${text}`;

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice,
        input: spokenText,
        speed,
        instructions:
          "Speak in natural Mexican Spanish. Use an authentic Mexican Spanish accent and pronunciation. " +
          "Speak like a native Mexican Spanish speaker in a casual conversation. Use natural Spanish " +
          "pronunciation, word stress, rhythm, and sentence intonation. For questions, use natural Mexican " +
          "Spanish question intonation. Use natural connected speech. Do not use an English accent. Do not " +
          "pronounce Spanish words using English pronunciation patterns. Speak clearly and naturally for a " +
          "Spanish learner. Do not exaggerate the accent.",
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text().catch(() => "");
      res.status(openaiRes.status).json({ error: errText || "OpenAI 요청이 실패했어요." });
      return;
    }

    const buf = Buffer.from(await openaiRes.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: e?.message || "중계 서버에서 오류가 났어요." });
  }
}

