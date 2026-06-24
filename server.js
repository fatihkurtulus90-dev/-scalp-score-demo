import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import PDFDocument from "pdfkit";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

let lastAnalysisResult = null;
let lastUserInfo = null;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function imageToBase64(path) {
  return fs.readFileSync(path).toString("base64");
}

function readLeads() {
  if (!fs.existsSync("leads.json")) return [];

  try {
    return JSON.parse(fs.readFileSync("leads.json", "utf-8"));
  } catch {
    return [];
  }
}

function writeLeads(leads) {
  fs.writeFileSync("leads.json", JSON.stringify(leads, null, 2));
}

const systemPrompt = `
Sen bir tıbbi teşhis sistemi değilsin.

Görevin saç ve saç derisi fotoğraflarını yalnızca görsel özellikler açısından değerlendirmektir.

Kesinlikle hastalık tanısı koyma.

Alopesi, seboreik dermatit, egzama, enfeksiyon, mantar, psoriasis gibi tıbbi tanılar verme.

Sadece görünüm, eğilim, izlenim, bakım ihtiyacı, görsel belirti ve ön değerlendirme dili kullan.

Markdown ekleme.
Kod bloğu ekleme.
Sadece ham JSON döndür.
Fotoğraf kalitesini ayrıca değerlendir.

Eğer fotoğraf çok bulanık, çok karanlık, çok uzak veya ilgili bölge görünmüyorsa:
- photo_quality alanını "poor" yap.
- quality_warnings alanına kısa Türkçe uyarılar yaz.
- confidence_score değerini düşük tut.

Eğer fotoğraflar yeterliyse:
- photo_quality alanını "good" yap.

"Besler", "onarır", "saç çıkarır", "dökülmeyi azaltır", "tedavi eder", "iyileştirir" gibi kesin etki veya tedavi anlamı taşıyan ifadeler kullanma.

Bunun yerine:
- destekleyebilir
- bakım rutinine katkı sağlayabilir
- bakım ihtiyacına işaret edebilir
- konforu desteklemeye yönelik olabilir

ifadelerini kullan.

Saç yaşı hesapla ancak bunu tıbbi yaş olarak sunma.
Saç yaşı yalnızca görsel yoğunluk, saç derisi dengesi, nem dengesi, yağ dengesi, pullanma görünümü ve bakım alışkanlıklarına göre oluşturulan iletişim amaçlı bir göstergedir.

top_focus_areas alanı mutlaka 3 kısa başlık içermelidir.
Başlıklar sade Türkçe olmalıdır.

Örnek başlıklar:
Saç Yoğunluğu
Nem Dengesi
Bakım Rutini
Yağ Dengesi
Pullanma
Hassasiyet
`;

app.post(
  "/analyze",
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "crown", maxCount: 1 },
    { name: "closeup", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        age,
        gender,
        washing,
        flaking,
        scalpFeeling,
        shedding,
        transplant,
        routine,
      } = req.body;

      if (!req.files?.front || !req.files?.crown || !req.files?.closeup) {
        return res.status(400).json({
          error: "Lütfen üç fotoğrafı da yükleyin.",
        });
      }

      const userText = `
Kullanıcı bilgileri:

Yaş: ${age}
Cinsiyet: ${gender}
Saç yıkama sıklığı: ${washing}
Kepek / pullanma: ${flaking}
Saç derisi hissi: ${scalpFeeling}
Son 12 ayda dökülme farkı: ${shedding}
Saç ekimi: ${transplant}
Düzenli saç ürünü kullanımı: ${routine}

Aşağıdaki JSON formatında Scalp Score analizi üret:

{
 
  "density_score": 0,
  "scalp_balance_score": 0,
  "moisture_balance_score": 0,
  "oil_balance_score": 0,
  "flaking_score": 0,
  "sensitivity_redness_score": 0,
  "routine_score": 0,
  "confidence_score": 0,
    "photo_quality": "good",
  "quality_warnings": [],

  "top_focus_areas": [],

  "main_observation": "",
  "strong_points": [],
  "improvement_areas": [],
  "recommended_focus": [],
  "user_friendly_summary": "",

  "safety_note": "Bu analiz tıbbi tanı değildir. Fotoğraflar ve bakım alışkanlıklarına göre bilgilendirme amaçlı hazırlanmış bir ön değerlendirmedir."
}

Kurallar:



- top_focus_areas yalnızca 3 kısa başlık içermelidir.
- top_focus_areas örnekleri: "Saç Yoğunluğu", "Nem Dengesi", "Bakım Rutini", "Yağ Dengesi", "Pullanma", "Hassasiyet".
- Tüm alt skorlar 0-100 arasında olmalıdır.
- 100 en iyi görünüm, 0 en zayıf görünüm anlamına gelir.
- user_friendly_summary kısa, sade ve kullanıcıyı endişelendirmeyen Türkçe ile yazılmalıdır.
`;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 1800,
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
                  media_type: req.files.front[0].mimetype,
                  data: imageToBase64(req.files.front[0].path),
                },
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: req.files.crown[0].mimetype,
                  data: imageToBase64(req.files.crown[0].path),
                },
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: req.files.closeup[0].mimetype,
                  data: imageToBase64(req.files.closeup[0].path),
                },
              },
            ],
          },
        ],
      });

      const rawText = response.content[0].text;

      const cleanedText = rawText
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      const result = JSON.parse(cleanedText);
      result.analysis_version = "3.0";

function clampScore(value, fallback = 60) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function normalizeScore(value) {
  const n = clampScore(value);

  if (n >= 85) return 90;
  if (n >= 75) return 80;
  if (n >= 65) return 70;
  if (n >= 55) return 60;
  if (n >= 45) return 50;
  if (n >= 35) return 40;
  return 30;
}

const realAge = Number(age);

const density = normalizeScore(result.density_score);
const scalpBalance = normalizeScore(result.scalp_balance_score);
const moisture = normalizeScore(result.moisture_balance_score);
const oil = normalizeScore(result.oil_balance_score);
const flakingScore = normalizeScore(result.flaking_score);
const sensitivity = normalizeScore(result.sensitivity_redness_score);
const routineScore = normalizeScore(result.routine_score);

result.density_score = density;
result.scalp_balance_score = scalpBalance;
result.moisture_balance_score = moisture;
result.oil_balance_score = oil;
result.flaking_score = flakingScore;
result.sensitivity_redness_score = sensitivity;
result.routine_score = routineScore;

const averageScore =
  density * 0.30 +
  scalpBalance * 0.10 +
  moisture * 0.15 +
  oil * 0.10 +
  flakingScore * 0.10 +
  sensitivity * 0.10 +
  routineScore * 0.15;

result.scalp_score = Math.round(averageScore);

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

if (result.scalp_score < 50) {
  result.score_category = "Yoğun Bakım İhtiyacı";
} else if (result.scalp_score < 70) {
  result.score_category = "Orta Düzey Bakım İhtiyacı";
} else if (result.scalp_score < 85) {
  result.score_category = "İyi Düzey";
} else {
  result.score_category = "Çok İyi Düzey";
}

if (result.photo_quality === "poor") {
  result.confidence_score = Math.min(
    Number(result.confidence_score || 60),
    55
  );
} else {
  result.confidence_score = Math.max(
    Number(result.confidence_score || 75),
    75
  );
}
   
      lastAnalysisResult = result;
      lastUserInfo = {
        age,
        gender,
        washing,
        flaking,
        scalpFeeling,
        shedding,
        transplant,
        routine,
      };

      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Analiz sırasında hata oluştu.",
      });
    }
  }
);

app.post("/save-lead", (req, res) => {
  try {
    const { fullName, phone, scalpScore, hairAge, focusAreas } = req.body;

    if (!fullName || !phone) {
      return res.status(400).json({
        success: false,
        error: "Ad soyad ve telefon zorunludur.",
      });
    }

    let leads = readLeads();

    const normalizedPhone = String(phone).replace(/\s+/g, "").trim();

    const existingIndex = leads.findIndex((item) => {
      const existingPhone = String(item.telefon || "")
        .replace(/\s+/g, "")
        .trim();

      return existingPhone === normalizedPhone;
    });

    if (existingIndex >= 0) {
      leads[existingIndex] = {
        ...leads[existingIndex],
        tarih: new Date().toISOString(),
        adSoyad: fullName,
        telefon: phone,
        scalpScore,
        hairAge,
        focusAreas: focusAreas || [],
        analizSayisi: (leads[existingIndex].analizSayisi || 1) + 1,
      };
    } else {
      leads.push({
        tarih: new Date().toISOString(),
        adSoyad: fullName,
        telefon: phone,
        scalpScore,
        hairAge,
        focusAreas: focusAreas || [],
        analizSayisi: 1,
      });
    }

    writeLeads(leads);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Lead kaydedilirken hata oluştu.",
    });
  }
});

app.get("/download-pdf", (req, res) => {
  if (!lastAnalysisResult) {
    return res.status(400).send("Henüz analiz yapılmadı.");
  }

  const result = lastAnalysisResult;
  const user = lastUserInfo || {};

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=sac-karnesi-raporu.pdf"
  );

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  doc.pipe(res);

  const regularFont = "fonts/NotoSans-Regular.ttf";
  const boldFont = "fonts/NotoSans-Bold.ttf";

  if (fs.existsSync(regularFont) && fs.existsSync(boldFont)) {
    doc.registerFont("Regular", regularFont);
    doc.registerFont("Bold", boldFont);
    doc.font("Regular");
  }

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  const colors = {
    text: "#111111",
    muted: "#6B6B6B",
    light: "#F4F4F1",
    border: "#E5E5E0",
    dark: "#1C1C1E",
    orange: "#C9852B",
    green: "#6A8F68",
    red: "#B94A48",
  };

  function write(value, x, y, options = {}) {
    doc
      .fillColor(options.color || colors.text)
      .font(options.bold ? "Bold" : "Regular")
      .fontSize(options.size || 12)
      .text(value, x, y, options);
  }

  function title(value, y) {
    write(value, 48, y, {
      size: 22,
      bold: true,
      width: pageWidth - 96,
    });
  }

  function subtitle(value, y) {
    write(value, 48, y, {
      size: 11,
      color: colors.muted,
      width: pageWidth - 96,
      lineGap: 4,
    });
  }

  function card(x, y, w, h) {
    doc.roundedRect(x, y, w, h, 18).fillAndStroke("#FFFFFF", colors.border);
  }

  function metricBar(label, value, y) {
    const safeValue = Number(value || 0);
    const barX = 48;
    const barY = y + 24;
    const barW = pageWidth - 96;
    const barH = 9;

    write(`${label}: ${safeValue} / 100`, 48, y, {
      size: 11,
      color: colors.text,
    });

    doc.roundedRect(barX, barY, barW, barH, 5).fill(colors.light);
    doc.roundedRect(barX, barY, (barW * safeValue) / 100, barH, 5).fill(colors.dark);
  }

  function scoreColor(score) {
    if (score < 50) return colors.red;
    if (score < 70) return colors.orange;
    return colors.green;
  }

  const score = Number(result.scalp_score || 0);
  const realAge = Number(user.age || 0);
  const hairAge = Number(result.hair_age || 0);
  const ageDiff = hairAge && realAge ? hairAge - realAge : 0;
  const confidence = result.confidence_score || 80;
  const focusAreas = result.top_focus_areas || result.recommended_focus || [];

  // SAYFA 1 — KAPAK
  doc.rect(0, 0, pageWidth, pageHeight).fill("#FFFFFF");

  write("RESNOVAE", 48, 54, {
    size: 13,
    bold: true,
    characterSpacing: 2,
  });

  write("SAÇ KARNENİZ HAZIR", 48, 138, {
    size: 28,
    bold: true,
    width: pageWidth - 96,
  });

  subtitle("Kişisel saç ve saç derisi görsel değerlendirme raporu", 178);

  doc.circle(pageWidth / 2, 330, 92).lineWidth(16).strokeColor(colors.light).stroke();
  doc.circle(pageWidth / 2, 330, 92).lineWidth(16).strokeColor(scoreColor(score)).stroke();

  write(`${score}`, pageWidth / 2 - 55, 292, {
    size: 52,
    bold: true,
    width: 110,
    align: "center",
  });

  write("/100", pageWidth / 2 - 30, 352, {
    size: 14,
    color: colors.muted,
    width: 60,
    align: "center",
  });

  write(result.score_category || "Kişisel Değerlendirme", 48, 460, {
    size: 18,
    bold: true,
    width: pageWidth - 96,
    align: "center",
  });

  subtitle(
    "Bu rapor, yüklenen fotoğraflar ve bakım alışkanlıklarına göre hazırlanmış bilgilendirme amaçlı bir ön değerlendirmedir. Tıbbi tanı yerine geçmez.",
    500
  );

  write("Yapay zekâ destekli görüntü analizi", 48, 720, {
    size: 10,
    color: colors.muted,
    width: pageWidth - 96,
    align: "center",
  });

  // SAYFA 2 — GENEL ÖZET
  doc.addPage();

  title("Genel Sonuç Özeti", 54);
  subtitle(
    "Saç derinizin genel görünümü, yaş bilgisi ve bakım alışkanlıkları birlikte değerlendirilmiştir.",
    88
  );

  const boxW = (pageWidth - 112) / 2;

  card(48, 140, boxW, 110);
  write("Scalp Score", 68, 162, { size: 11, color: colors.muted });
  write(`${score}/100`, 68, 190, { size: 28, bold: true });

  card(64 + boxW, 140, boxW, 110);
  write("Saç Yaşı", 84 + boxW, 162, { size: 11, color: colors.muted });
  write(`${hairAge || "-"}`, 84 + boxW, 190, { size: 28, bold: true });

  card(48, 270, boxW, 110);
  write("Yaş Farkı", 68, 292, { size: 11, color: colors.muted });
  write(ageDiff > 0 ? `+${ageDiff} yıl` : `${ageDiff} yıl`, 68, 320, {
    size: 28,
    bold: true,
    color: ageDiff > 0 ? colors.orange : colors.green,
  });

  card(64 + boxW, 270, boxW, 110);
  write("Analiz Güveni", 84 + boxW, 292, { size: 11, color: colors.muted });
  write(`${confidence}%`, 84 + boxW, 320, { size: 28, bold: true });

  title("Kısa Değerlendirme", 430);

  write(result.user_friendly_summary || "Kişisel değerlendirme oluşturuldu.", 48, 468, {
    size: 12,
    color: colors.muted,
    width: pageWidth - 96,
    lineGap: 5,
  });

  // SAYFA 3 — SAÇ SAĞLIĞI HARİTASI
  doc.addPage();

  title("Saç Sağlığı Haritası", 54);
  subtitle(
    "Aşağıdaki skorlar, saç ve saç derisinin görsel değerlendirmesine göre hazırlanmıştır.",
    88
  );

  let y = 145;

  metricBar("Yoğunluk Görünümü", result.density_score, y);
  y += 58;
  metricBar("Saç Derisi Dengesi", result.scalp_balance_score, y);
  y += 58;
  metricBar("Nem Dengesi", result.moisture_balance_score, y);
  y += 58;
  metricBar("Yağ Dengesi", result.oil_balance_score, y);
  y += 58;
  metricBar("Pullanma / Kepek Görünümü", result.flaking_score, y);
  y += 58;
  metricBar("Hassasiyet / Kızarıklık Görünümü", result.sensitivity_redness_score, y);
  y += 58;
  metricBar("Bakım Rutini", result.routine_score, y);

  // SAYFA 4 — GÜÇLÜ YÖNLER VE ODAK ALANLARI
  doc.addPage();

  title("Güçlü Yönler ve Gelişim Alanları", 54);
  subtitle(
    "Bu bölüm, saç derinizin olumlu görünen alanlarını ve geliştirilmesi önerilen öncelikli başlıkları gösterir.",
    88
  );

  card(48, 140, pageWidth - 96, 170);
  write("Güçlü Görünen Alanlar", 68, 166, {
    size: 16,
    bold: true,
  });

  const strongPoints = result.strong_points?.length
    ? result.strong_points
    : [
        "Pullanma ve kepek görünümünün düşük olması olumlu bir göstergedir.",
        "Hassasiyet veya kızarıklık görünümü belirgin değilse saç derisi konforu açısından olumlu kabul edilebilir.",
        "Yağ dengesi görünümü genel bakım rutini açısından takip edilebilir düzeydedir.",
      ];

  let sy = 202;

  strongPoints.slice(0, 3).forEach((item) => {
    write(`✓ ${item}`, 68, sy, {
      size: 11,
      color: colors.muted,
      width: pageWidth - 136,
      lineGap: 3,
    });
    sy += 38;
  });

  card(48, 350, pageWidth - 96, 220);
  write("Öncelikli Odak Alanları", 68, 376, {
    size: 16,
    bold: true,
  });

  let fy = 414;

  focusAreas.slice(0, 3).forEach((item, index) => {
    write(`${index + 1}. ${item}`, 68, fy, {
      size: 13,
      bold: true,
    });

    write(
      "Bu başlık, bakım rutininizde önceliklendirilmesi önerilen alanlardan biridir.",
      68,
      fy + 22,
      {
        size: 10,
        color: colors.muted,
        width: pageWidth - 136,
      }
    );

    fy += 58;
  });

  // SAYFA 5 — 30 GÜNLÜK PLAN
  doc.addPage();

  title("30 Günlük Saç Derisi Denge Planı", 54);
  subtitle(
    "Bu plan, saç derisi konforu ve düzenli bakım alışkanlığını desteklemek amacıyla hazırlanmıştır.",
    88
  );

  const weeks = [
    {
      title: "Hafta 1",
      goal: "Temizleme düzenini dengeleme",
      desc: "Saç derisinin verdiği kuruluk, yağlanma veya hassasiyet sinyallerini takip edin.",
    },
    {
      title: "Hafta 2",
      goal: "Nem ve konfor desteği",
      desc: "Saç derisi bakım rutininize düzenli ve hafif yapılı destekleyici ürünler ekleyin.",
    },
    {
      title: "Hafta 3",
      goal: "Yoğunluk görünümü takibi",
      desc: "Aynı ışık ve açıyla haftalık fotoğraf çekerek değişimi takip edin.",
    },
    {
      title: "Hafta 4",
      goal: "Yeniden değerlendirme",
      desc: "30 gün sonunda yeniden analiz yaparak Scalp Score değişiminizi görün.",
    },
  ];

  y = 145;

  weeks.forEach((week) => {
    card(48, y, pageWidth - 96, 105);

    write(week.title, 68, y + 22, {
      size: 13,
      bold: true,
    });

    write(week.goal, 150, y + 22, {
      size: 13,
      bold: true,
    });

    write(week.desc, 150, y + 48, {
      size: 10.5,
      color: colors.muted,
      width: pageWidth - 220,
      lineGap: 3,
    });

    y += 125;
  });

  // SAYFA 6 — RESNOVAE BÖLÜMÜ
  doc.addPage();

  title("Bakım Yaklaşımı", 54);
  subtitle(
    "Saç derisi bakımında temel hedef; konfor, nem dengesi ve düzenli bakım alışkanlığının desteklenmesidir.",
    88
  );

  card(48, 150, pageWidth - 96, 250);

  write("Resnovae Scalp MD", 68, 180, {
    size: 18,
    bold: true,
  });

  write(
    "Saç derisinin konforu, nem dengesi ve bakım rutininin desteklenmesi amacıyla geliştirilen biyoteknolojik bakım yaklaşımıdır.",
    68,
    220,
    {
      size: 12,
      color: colors.muted,
      width: pageWidth - 136,
      lineGap: 5,
    }
  );

  write(
    "Bu raporda yer alan öneriler tıbbi tedavi önerisi değildir. Saç dökülmesi, kızarıklık, kaşıntı, hassasiyet veya benzeri durumlarda dermatoloji uzmanına danışılması önerilir.",
    68,
    310,
    {
      size: 10.5,
      color: colors.muted,
      width: pageWidth - 136,
      lineGap: 4,
    }
  );

  write("Rapor Notu", 48, 470, {
    size: 14,
    bold: true,
  });

  write(result.safety_note || "Bu analiz tıbbi tanı değildir.", 48, 500, {
    size: 10,
    color: colors.muted,
    width: pageWidth - 96,
    lineGap: 4,
  });

  write("Resnovae Saç Karnesi", 48, 735, {
    size: 10,
    color: colors.muted,
    width: pageWidth - 96,
    align: "center",
  });

  doc.end();
});

app.get("/admin-data", (req, res) => {
  const leads = readLeads();
  res.json(leads);
});

app.get("/download-leads", (req, res) => {
  const leads = readLeads();

  if (!leads.length) {
    return res.status(400).send("Henüz lead yok.");
  }

  const header =
    "Tarih,Ad Soyad,Telefon,Scalp Score,Saç Yaşı,Analiz Sayısı,Odak Alanları\n";

  const rows = leads.map((item) => {
    return [
      item.tarih,
      item.adSoyad,
      item.telefon,
      item.scalpScore,
      item.hairAge,
      item.analizSayisi || 1,
      (item.focusAreas || []).join(" | "),
    ].join(",");
  });

  const csv = header + rows.join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=leads.csv");

  res.send("\uFEFF" + csv);
});

app.get("/care-plan", (req, res) => {
  if (!lastAnalysisResult) {
    return res.json({
      error: "Henüz analiz yapılmadı",
    });
  }

  const score = lastAnalysisResult.scalp_score;

  let plan;

  if (score < 50) {
    plan = {
      title: "Yoğun Destek Planı",
      week1:
        "Saç derisi temizliğini düzenleyin ve haftalık fotoğraf takibi başlatın.",
      week2: "Nem dengesi ve saç derisi konforuna odaklanın.",
      week3: "Yoğunluk görünümünü destekleyecek bakım rutini oluşturun.",
      week4: "Yeniden analiz yaparak değişimi ölçün.",
      recommendation:
        "Resnovae Scalp MD bakım sürecinin bir parçası olarak değerlendirilebilir.",
    };
  } else if (score < 70) {
    plan = {
      title: "Gelişim Planı",
      week1: "Yıkama ve bakım düzeninizi standardize edin.",
      week2: "Saç derisinin nem ve konfor durumunu takip edin.",
      week3: "Düzenli bakım alışkanlığı oluşturun.",
      week4: "Yeni Scalp Score ölçümü yapın.",
      recommendation:
        "Resnovae Scalp MD düzenli bakım yaklaşımına destek sağlayabilir.",
    };
  } else {
    plan = {
      title: "Koruma Planı",
      week1: "Mevcut rutini koruyun.",
      week2: "Haftalık fotoğraf takibi yapın.",
      week3: "Saç derisi dengesini sürdürmeye odaklanın.",
      week4: "Yeni analiz ile değişimi kontrol edin.",
      recommendation:
        "Mevcut dengeyi korumaya yönelik bakım yaklaşımı sürdürülebilir.",
    };
  }

  res.json(plan);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Scalp Score çalışıyor: ${PORT}`);
});