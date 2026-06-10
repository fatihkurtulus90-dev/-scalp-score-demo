import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function imageToBase64(path) {
  return fs.readFileSync(path).toString("base64");
}
const systemPrompt = `
Sen bir tıbbi teşhis sistemi değilsin.

Görevin, saç ve saç derisi fotoğraflarını yalnızca görsel özellikler açısından değerlendirmektir.

Kesinlikle hastalık tanısı koyma.

Alopesi, seboreik dermatit, egzama, enfeksiyon, mantar, psoriasis gibi tıbbi tanılar verme.

Sadece görünüm, eğilim, izlenim, bakım ihtiyacı, görsel belirti ve ön değerlendirme dili kullan.

"besler", "onarır", "dökülmeyi azaltır", "saç çıkarır", "tedavi eder", "iyileştirir" gibi kesin etki veya tedavi anlamı taşıyan ifadeler kullanma.

Bunun yerine:
- destekleyebilir
- bakım rutinine katkı sağlayabilir
- bakım ihtiyacına işaret edebilir
- konforu desteklemeye yönelik olabilir

ifadelerini kullan.

Çıktının başına veya sonuna markdown ekleme.

\`\`\`json
etiketi ekleme.

Açıklama yazma.

Sadece geçerli ham JSON döndür.

Aşağıdaki parametreleri 0-100 arasında puanla:

- density_score
- scalp_balance_score
- moisture_balance_score
- oil_balance_score
- flaking_score
- sensitivity_redness_score
- routine_score
- confidence_score

Scalp Score formülü:

0.25 * density_score +
0.20 * scalp_balance_score +
0.15 * moisture_balance_score +
0.15 * oil_balance_score +
0.10 * flaking_score +
0.10 * sensitivity_redness_score +
0.05 * routine_score

Çıktıyı yalnızca geçerli JSON formatında ver.
`;

const userText = `
Kullanıcı bilgileri:

Yaş: 38
Cinsiyet: Erkek
Saç yıkama sıklığı: Haftada 4
Kepek/pullanma: Ara sıra
Saç derisi hissi: Kuru
Son 12 ayda dökülme farkı: Belirgin
Saç ekimi: Hayır
Düzenli saç ürünü kullanımı: Hayır

Lütfen fotoğraflar ve bilgilerle Scalp Score analizini üret.

JSON formatı:

{
  "scalp_score": 0,
  "score_category": "",
  "density_score": 0,
  "scalp_balance_score": 0,
  "moisture_balance_score": 0,
  "oil_balance_score": 0,
  "flaking_score": 0,
  "sensitivity_redness_score": 0,
  "routine_score": 0,
  "confidence_score": 0,
  "main_observation": "",
  "strong_points": [],
  "improvement_areas": [],
  "recommended_focus": [],
  "user_friendly_summary": "",
  "safety_note": "Bu analiz tıbbi tanı değildir. Fotoğraflar ve bakım alışkanlıklarına göre bilgilendirme amaçlı hazırlanmış bir ön değerlendirmedir."
}
`;

const response = await anthropic.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1500,
  system: systemPrompt,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: imageToBase64("front.jpg"),
          },
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: imageToBase64("crown.jpg"),
          },
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: imageToBase64("closeup.jpg"),
          },
        },
      ],
    },
  ],
});

const rawText = response.content[0].text;

console.log("CLAUDE CEVABI:");
console.log(rawText);

const cleanedText = rawText
  .replace(/```json/g, "")
  .replace(/```/g, "")
  .trim();

const result = JSON.parse(cleanedText);
const realAge = Number(age);
const density = Number(result.density_score || 60);
const moisture = Number(result.moisture_balance_score || 60);
const oil = Number(result.oil_balance_score || 60);
const flaking = Number(result.flaking_score || 60);
const sensitivity = Number(result.sensitivity_redness_score || 60);
const routineScore = Number(result.routine_score || 60);

const averageScore =
  density * 0.30 +
  moisture * 0.15 +
  oil * 0.10 +
  flaking * 0.10 +
  sensitivity * 0.15 +
  routineScore * 0.20;

let ageAdjustment = 0;

if (averageScore >= 85) {
  ageAdjustment = -5;
} else if (averageScore >= 75) {
  ageAdjustment = -3;
} else if (averageScore >= 65) {
  ageAdjustment = 0;
} else if (averageScore >= 55) {
  ageAdjustment = 3;
} else if (averageScore >= 45) {
  ageAdjustment = 6;
} else {
  ageAdjustment = 10;
}

result.hair_age = Math.max(18, realAge + ageAdjustment);
result.scalp_score = Math.round(averageScore);

console.log("\n==============================");
console.log("SAÇ KARNESİ HAZIR");
console.log("==============================\n");

console.log(`Scalp Score: ${result.scalp_score} / 100`);
console.log(`Kategori: ${result.score_category}`);
console.log(`Analiz Güven Skoru: ${result.confidence_score} / 100`);

console.log("\nAna Gözlem:");
console.log(result.main_observation);

console.log("\nGüçlü Alanlar:");
result.strong_points.forEach((item, index) => {
  console.log(`${index + 1}. ${item}`);
});

console.log("\nGeliştirilebilir Alanlar:");
result.improvement_areas.forEach((item, index) => {
  console.log(`${index + 1}. ${item}`);
});

console.log("\nÖnerilen Odak:");
result.recommended_focus.slice(0, 3).forEach((item, index) => {
  console.log(`${index + 1}. ${item}`);
});

console.log("\nKullanıcı Özeti:");
console.log(result.user_friendly_summary);

console.log("\nNot:");
console.log(result.safety_note);