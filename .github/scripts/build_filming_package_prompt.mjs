#!/usr/bin/env node
/** Build a portable filming-package prompt from a business profile. */

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";


export async function loadProfile(path) {
  const profile = JSON.parse(await readFile(path, "utf8"));
  if (!profile || Array.isArray(profile) || typeof profile !== "object") {
    throw new Error("Business profile kökte bir JSON nesnesi olmalı.");
  }
  return profile;
}


export function turkishUpper(value) {
  return value.replaceAll("i", "İ").replaceAll("ı", "I").toUpperCase();
}


export function renderSystemPrompt(profile) {
  const { business, offer, content, assets } = profile;
  const brand = business.brand_name;
  const presenter = business.owner_display_name;
  const primaryDevice = content.capture.primary_device;
  const isPhone = primaryDevice.trim() === "Telefon";
  const equipmentLines = offer.available_equipment.map((item) => `- ${item}`).join("\n");
  const secondaryFormats = content.secondary_formats.join(", ");
  const assetNotes = assets.notes || "Ek marka varlığı notu yok.";

  const deviceSpecificRules = isPhone
    ? `

TELEFON ÖZEL KURALLARI:
- Telefon desteği gerekiyorsa yalnız güvenli çözümler öner ve düşme kontrolü yaptır.
- Arka kamera ve 1080p/30 fps kullan.
- Pil, depolama ve Rahatsız Etmeyin ayarını kontrol et.`
    : "";

  return `Sen ${brand} için çekim yönetmeni ve prodüksiyon planlayıcısısın.
Görevin, ${presenter} tarafından onaylanan tek senaryoyu DEĞİŞTİRMEDEN uygulanabilir,
kısa ve çekim sırasında doğrudan kullanılabilir bir pakete dönüştürmektir.

İŞLETME BAĞLAMI:
- Marka: ${brand}
- Gösterilecek kişi / işletme sahibi: ${presenter}
- Kategori: ${business.category}
- İkincil içerik formatları: ${secondaryFormats}
- Marka varlığı notu: ${assetNotes}
- Ana kayıt cihazı: ${primaryDevice}

MEVCUT EKİPMANLAR:
${equipmentLines}

ZORUNLU KURALLAR:
1. Yalnızca yukarıdaki mevcut ekipmanları kullan; yeni ekipman satın aldırma veya listede olmayan ekipmanı varmış gibi yazma.
2. Kayıt cihazını güvenli ve sabit biçimde yerleştir; düşme veya devrilme riskini ortadan kaldır.
3. Mevcut ışık kaynaklarını güvenli ve konuya uygun yerleştir; gösterilecek kişiyi ters ışıkta bırakma.
4. Ana videoyu yatay, uygun ikincil kısa video kesitini ayrıca dikey çektir.
5. Sessiz ortam ve kısa deneme kaydı kullan; ses patlıyorsa kayıt cihazını güvenli biçimde uzaklaştır.
6. Onaylı konuşma metnini ve içeriğe ait teknik ayrıntıları değiştirme.
7. Aynı kayıt cihazıyla eşzamanlı iki açı isteme; farklı açıları ayrı çekimler olarak planla.
8. Her sahnede kadraj, hareket, ses/ışık ve hata kontrolü açık olsun.
9. Yalnız kaynakta bulunan seçilmiş tek senaryo için paket üret.
10. Kayıt cihazının konumunu mümkün olduğunca az değiştiren çekim sırası oluştur.
11. Çıktıyı kısa ve uygulanabilir tut.
12. Profilde açıkça belirtilmeyen teknik özelliği (çözünürlük, fps, lens, sensör vb.) uydurma; yalnızca profildeki bilgiyi ve genel güvenli kayıt cihazı kontrollerini kullan.${deviceSpecificRules}

ZORUNLU ÇIKTI BİÇİMİ:
# 🎥 ${turkishUpper(brand)} — ÇEKİM PAKETİ
## 1. Çekimden Önce Ortak Hazırlık
## 2. Oda ve Kayıt Cihazı Yerleşimi
## 3. Seçilen Senaryo Çekim Planı
Markdown tablo: Sıra | Bölüm | Kayıt Cihazı/Kadraj | Gösterilecek Kişinin Yapacağı | Ses/Işık | Kontrol
## 4. Shorts/Reels Dikey Çekimi
## 5. En Verimli Çekim Sırası
## 6. Çekim Sonu Dosya Kontrolü

Yalnızca nihai Markdown metnini yaz. Ön açıklama, özür veya kod bloğu ekleme.
`;
}


export function renderMetadata(profile) {
  return {
    request_intro:
      `Aşağıdaki ${profile.business.owner_display_name} onaylı ve üretime açıkça ` +
      "seçilmiş tek senaryo için çekim paketi hazırla.",
    equipment_summary: profile.offer.available_equipment.join(", "),
    primary_device: profile.content.capture.primary_device,
  };
}


function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    values.set(argv[index], argv[index + 1]);
  }
  for (const name of ["--profile", "--system-output", "--metadata-output"]) {
    if (!values.get(name)) throw new Error(`Eksik argüman: ${name}`);
  }
  return values;
}


async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = await loadProfile(args.get("--profile"));
  await writeFile(args.get("--system-output"), renderSystemPrompt(profile), "utf8");
  await writeFile(
    args.get("--metadata-output"),
    `${JSON.stringify(renderMetadata(profile), null, 2)}\n`,
    "utf8",
  );
}


if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
