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
  "scalp_score": 0,
  "hair_age": 0,
  "score_category": "",

  "density_score": 0,
  "scalp_balance_score": 0,
  "moisture_balance_score": 0,
  "oil_balance_score": 0,
  "flaking_score": 0,
  "sensitivity_redness_score": 0,
  "routine_score": 0,
  "confidence_score": 0,

  "top_focus_areas": [],

  "main_observation": "",
  "strong_points": [],
  "improvement_areas": [],
  "recommended_focus": [],
  "user_friendly_summary": "",

  "safety_note": "Bu analiz tıbbi tanı değildir. Fotoğraflar ve bakım alışkanlıklarına göre bilgilendirme amaçlı hazırlanmış bir ön değerlendirmedir."
}

Kurallar:
- scalp_score 0-100 arasında olmalıdır.
- hair_age kullanıcının gerçek yaşından düşük, eşit veya yüksek olabilir.
- hair_age tıbbi yaş değil, görsel saç derisi değerlendirme yaş izlenimidir.
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
  const user = lastUserInfo;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=sac-karnesi-raporu.pdf"
  );

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(26).text("Saç Karnesi", { align: "center" });
  doc.moveDown();

  doc.fontSize(14).text("Kişisel Saç Derisi Denge Raporu", {
    align: "center",
  });

  doc.moveDown(2);

  doc.fontSize(36).text(`${result.scalp_score} / 100`, {
    align: "center",
  });

  doc.fontSize(16).text(result.score_category || "", {
    align: "center",
  });

  doc.moveDown();

  doc.fontSize(14).text(`Gerçek Yaş: ${user.age}`, { align: "center" });
  doc.fontSize(14).text(`Saç Yaşı: ${result.hair_age}`, { align: "center" });

  doc.moveDown(2);

  doc.fontSize(18).text("Saç Sağlığı Haritası");
  doc.moveDown();

  doc.fontSize(12).text(`Yoğunluk Görünümü: ${result.density_score} / 100`);
  doc.text(`Saç Derisi Dengesi: ${result.scalp_balance_score} / 100`);
  doc.text(`Nem Dengesi: ${result.moisture_balance_score} / 100`);
  doc.text(`Yağ Dengesi: ${result.oil_balance_score} / 100`);
  doc.text(`Pullanma / Kepek: ${result.flaking_score} / 100`);
  doc.text(`Hassasiyet / Kızarıklık: ${result.sensitivity_redness_score} / 100`);
  doc.text(`Bakım Rutini: ${result.routine_score} / 100`);

  doc.moveDown(2);

  doc.fontSize(18).text("Öncelikli Odak Alanları");
  doc.moveDown();

  (result.top_focus_areas || []).forEach((item, index) => {
    doc.fontSize(12).text(`${index + 1}. ${item}`);
  });

  doc.addPage();

  doc.fontSize(20).text("Kişisel Değerlendirme");
  doc.moveDown();
  doc.fontSize(12).text(result.user_friendly_summary || "");

  doc.moveDown(2);

  doc.fontSize(20).text("30 Günlük Saç Derisi Denge Planı");
  doc.moveDown();

  doc.fontSize(13).text("Hafta 1: Temizleme düzenini dengeleme");
  doc.fontSize(11).text(
    "Saç derisinin verdiği kuruluk, yağlanma veya hassasiyet sinyallerini takip edin."
  );

  doc.moveDown();

  doc.fontSize(13).text("Hafta 2: Nem ve konfor desteği");
  doc.fontSize(11).text(
    "Saç derisi bakım rutininize düzenli ve hafif yapılı destekleyici ürünler ekleyin."
  );

  doc.moveDown();

  doc.fontSize(13).text("Hafta 3: Yoğunluk görünümü takibi");
  doc.fontSize(11).text(
    "Aynı ışık ve açıyla haftalık fotoğraf çekerek değişimi takip edin."
  );

  doc.moveDown();

  doc.fontSize(13).text("Hafta 4: Yeniden değerlendirme");
  doc.fontSize(11).text(
    "30 gün sonunda yeniden analiz yaparak Scalp Score değişiminizi görün."
  );

  doc.moveDown(2);

  doc.fontSize(20).text("Önerilen Bakım Yaklaşımı");
  doc.moveDown();

  doc.fontSize(12).text(
    "Saç derisi konforu, nem dengesi ve düzenli bakım rutininin desteklenmesi için Resnovae Scalp MD bakım sürecinin bir parçası olarak değerlendirilebilir."
  );

  doc.moveDown();

  doc.fontSize(10).fillColor("gray").text(result.safety_note || "");

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