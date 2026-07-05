"use strict";

const APPLY_FIELD_ORDER = ["agency_name", "hero_title", "hero_subtitle", "hero_cta_text"];
const CITY_DEFINITIONS = [
  { value: "Kyiv", patterns: [/\bkyiv\b/i, /\bкиїв(?:а|у|і|ом)?\b/i, /\bкиев(?:а|у|е|ом)?\b/i] },
  { value: "Odesa", patterns: [/\bodesa\b/i, /\bodessa\b/i, /\bодеса\b/i, /\bодес(?:а|у|і|ой)?\b/i] },
  { value: "Lviv", patterns: [/\blviv\b/i, /\bльвів(?:а|у|і|ом)?\b/i, /\bльвов(?:а|у|е|ом)?\b/i] },
  { value: "Mykolaiv", patterns: [/\bmykolaiv\b/i, /\bnikolaev\b/i, /\bмиколаїв(?:а|у|і|ом)?\b/i, /\bниколаев(?:а|у|е|ом)?\b/i] }
];

function clampText(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function titleCaseWords(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function detectCity(prompt) {
  for (const city of CITY_DEFINITIONS) {
    for (const pattern of city.patterns) {
      if (pattern.test(prompt)) {
        return city.value;
      }
    }
  }

  return "";
}

function cleanAgencyName(value) {
  return clampText(
    String(value || "")
      .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
      .replace(/\s+(?:для|for|in|with|та|and)\b.*$/i, "")
      .replace(/[.,;:]+$/g, "")
      .trim(),
    80
  );
}

function detectAgencyName(prompt, city) {
  const patterns = [
    /(?:агентство|agency|brand|company|назва)\s+([A-ZА-ЯІЇЄҐ][A-ZА-ЯІЇЄҐA-Za-z0-9 &'’`.-]{2,80})/iu,
    /([A-Z][A-Za-z0-9 &'’`.-]{2,80})\s+(?:agency|realty|properties|real estate)/i
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match && match[1]) {
      const cleaned = cleanAgencyName(match[1]);
      if (cleaned) {
        return cleaned;
      }
    }
  }

  if (city) {
    return clampText(city + " Realty", 80);
  }

  return "Prime Realty";
}

function detectToneAndStyle(lowerPrompt) {
  if (/(преміаль|premium|luxury|люкс)/i.test(lowerPrompt)) {
    return {
      tone: "premium",
      style_slug: "slate"
    };
  }

  if (/(сімей|family|friendly|тепл)/i.test(lowerPrompt)) {
    return {
      tone: "warm",
      style_slug: "beige"
    };
  }

  if (/(modern|сучасн)/i.test(lowerPrompt)) {
    return {
      tone: "modern",
      style_slug: "slate"
    };
  }

  return {
    tone: "premium",
    style_slug: "turquoise"
  };
}

function detectFocus(lowerPrompt) {
  return {
    apartments: /(квартир|apartments?)/i.test(lowerPrompt),
    houses: /(будин|houses?)/i.test(lowerPrompt),
    nearMetro: /(біля метро|near metro|metro)/i.test(lowerPrompt)
  };
}

function buildHeroTitle(agencyName, city, tone) {
  if (tone === "premium") {
    return clampText(agencyName + " - Premium Real Estate in " + city, 120);
  }

  if (tone === "warm") {
    return clampText(agencyName + " - Homes and Properties in " + city, 120);
  }

  return clampText(agencyName + " - Real Estate in " + city, 120);
}

function buildHeroSubtitle(city, focus, tone) {
  if (focus.apartments && focus.nearMetro) {
    return clampText("Find selected apartments near metro stations and prime city districts in " + city + ".", 240);
  }

  if (focus.apartments) {
    return clampText("Browse apartments and investment-ready homes across " + city + ".", 240);
  }

  if (focus.houses) {
    return clampText("Explore houses, apartments, and premium neighborhoods across " + city + ".", 240);
  }

  if (tone === "premium") {
    return clampText("Discover premium apartments, houses, and investment properties across " + city + ".", 240);
  }

  return clampText("Find apartments, houses, and commercial spaces in " + city + ".", 240);
}

function buildHeroCtaText(city, focus) {
  if (focus.apartments) {
    return clampText("Browse " + titleCaseWords(city) + " Listings", 60);
  }

  if (focus.houses) {
    return clampText("Explore " + titleCaseWords(city) + " Homes", 60);
  }

  return clampText("Browse Properties", 60);
}

function derivePromptPersonalization(prompt) {
  const sourcePrompt = String(prompt || "").trim();
  const lowerPrompt = sourcePrompt.toLowerCase();
  const city = detectCity(sourcePrompt) || "Kyiv";
  const agencyName = detectAgencyName(sourcePrompt, city);
  const designProfile = detectToneAndStyle(lowerPrompt);
  const focus = detectFocus(lowerPrompt);
  const fields = {
    agency_name: clampText(agencyName, 80),
    city: clampText(city, 80),
    hero_title: buildHeroTitle(agencyName, city, designProfile.tone),
    hero_subtitle: buildHeroSubtitle(city, focus, designProfile.tone),
    hero_cta_text: buildHeroCtaText(city, focus)
  };
  const warnings = [];

  if (!String(prompt || "").trim()) {
    warnings.push("Prompt personalization fell back to defaults because the prompt was empty.");
  }

  return {
    source: "local_interpreter",
    applies_changes: true,
    provider_called: false,
    fields,
    design_profile: designProfile,
    warnings
  };
}

function buildPlanningContextFromPersonalization(personalization) {
  const safe = personalization && typeof personalization === "object" ? personalization : derivePromptPersonalization("");
  const fields = safe.fields && typeof safe.fields === "object" ? safe.fields : {};
  const designProfile = safe.design_profile && typeof safe.design_profile === "object" ? safe.design_profile : {};

  return {
    preset: "real-estate",
    preset_variables: {
      agency_name: clampText(fields.agency_name || "", 80),
      hero_title: clampText(fields.hero_title || "", 120),
      hero_subtitle: clampText(fields.hero_subtitle || "", 240),
      hero_cta_text: clampText(fields.hero_cta_text || "", 60)
    },
    style_context: {
      tone: clampText(designProfile.tone || "premium", 40),
      primary_preset: clampText(designProfile.style_slug || "turquoise", 40)
    },
    image_context: {
      source: "demo_pool",
      mode: "round_robin"
    }
  };
}

function summarizeAppliedFieldKeys(personalization) {
  const fields = personalization && personalization.fields && typeof personalization.fields === "object"
    ? personalization.fields
    : {};

  return APPLY_FIELD_ORDER.filter((key) => String(fields[key] || "").trim() !== "");
}

module.exports = {
  buildPlanningContextFromPersonalization,
  derivePromptPersonalization,
  summarizeAppliedFieldKeys
};
