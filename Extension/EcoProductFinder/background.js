// background.js - updated to centrally store keys and perform HF / Google Vision enrichment
// Preserves the Gemini logic and the 'findAlternatives' flow, but now supports an end-to-end
// "enrichAndFindAlternatives" action which enriches productInfo, calls Gemini, and returns both
// the enrichment metadata and Gemini alternatives.

class GeminiAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
  }

  async generateContent(prompt) {
    try {
      const body = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
          },
        }),
      };

      const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, body);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    } catch (error) {
      console.error("Gemini API Error:", error);
      throw error;
    }
  }

  async findEcoAlternatives(productInfo) {
    const prompt = `
    Analyze this product information and suggest 3-5 eco-friendly, organic, or sustainable alternatives:
    
    Product: ${productInfo.title}
    Category: ${productInfo.category}
    Price Range: ${productInfo.price}
    Description: ${productInfo.description}
    EcoAttributes: ${productInfo.ecoAttributes ? JSON.stringify(productInfo.ecoAttributes) : "[]"}
    
    Please provide alternatives in this exact JSON format:
    {
      "alternatives": [
        {
          "name": "Product Name",
          "description": "Brief eco-friendly description",
          "ecoFeatures": ["feature1", "feature2"],
          "estimatedPrice": "$X-Y",
          "searchQuery": "product name eco organic",
          "amazonSearchUrl": "https://amazon.com/s?k=search+query"
        }
      ]
    }
    
    Focus on products that are:
    - Organic or made from sustainable materials
    - Have minimal environmental impact
    - Are biodegradable or recyclable
    - Support fair trade or ethical manufacturing
    - Have eco-certifications
    `;

    const response = await this.generateContent(prompt);

    try {
      // Extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error("No valid JSON found in Gemini response");
    } catch (error) {
      console.error("Error parsing Gemini response:", error);
      return { alternatives: [] };
    }
  }
}

// Helper: fetch stored keys
function getStoredKeys() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ["geminiApiKey", "hfApiKey", "googleVisionApiKey"],
      (result) => resolve(result || {})
    );
  });
}

// Helper: Hugging Face zero-shot (returns label & scores)
async function hfZeroShot(hfApiKey, text, candidateLabels) {
  try {
    const resp = await fetch("https://api-inference.huggingface.co/models/facebook/bart-large-mnli", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hfApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: text,
        parameters: { candidate_labels: candidateLabels, multi_label: false },
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`HF zero-shot error ${resp.status}: ${errText}`);
    }
    const data = await resp.json();
    return data; // { labels: [...], scores: [...], sequence: "..." }
  } catch (err) {
    console.error("HF zero-shot error:", err);
    throw err;
  }
}

// Helper: Hugging Face NER
async function hfNER(hfApiKey, text) {
  try {
    const resp = await fetch("https://api-inference.huggingface.co/models/dbmdz/bert-large-cased-finetuned-conll03-english", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hfApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`HF NER error ${resp.status}: ${errText}`);
    }
    const data = await resp.json();
    return data; // typically array of entity objects
  } catch (err) {
    console.error("HF NER error:", err);
    throw err;
  }
}

// Helper: Google Vision label detection (imageUri)
async function googleVisionLabels(visionKey, imageUri) {
  try {
    const req = {
      requests: [
        {
          image: { source: { imageUri } },
          features: [{ type: "LABEL_DETECTION", maxResults: 10 }],
        },
      ],
    };

    const resp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Vision API error ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    return data;
  } catch (err) {
    console.error("Google Vision error:", err);
    throw err;
  }
}

// Enrichment pipeline: returns enriched productInfo + enrichmentSteps metadata
async function enrichProductInfoPipeline(productInfo, keys) {
  const enriched = Object.assign({}, productInfo);
  enriched.ecoAttributes = enriched.ecoAttributes || [];
  const enrichmentSteps = {
    zeroShot: false,
    ner: false,
    keywords: false,
    vision: false,
    notes: [],
  };

  const combinedText = `${productInfo.title || ""} ${productInfo.description || ""}`.trim();

  const sustainabilityKeywords = [
    "organic", "biodegradable", "compostable", "fair trade",
    "recyclable", "sustainable", "eco-friendly", "renewable",
    "bamboo", "carbon neutral", "upcycled", "plant-based",
    "non-toxic", "natural", "vegan", "cruelty-free", "recycled"
  ];

  // Zero-shot
  if (keys.hfApiKey && combinedText) {
    try {
      const candidateLabels = [
        "electronics",
        "home & kitchen",
        "fashion",
        "beauty & personal care",
        "sports & outdoors",
        "books",
        "eco-friendly products",
        "organic products",
        "recyclable materials",
        "renewable energy",
        "toys",
        "health",
        "pet supplies",
        "office supplies"
      ];

      const zs = await hfZeroShot(keys.hfApiKey, combinedText, candidateLabels);
      if (zs && Array.isArray(zs.labels) && zs.labels.length > 0) {
        enriched.category = zs.labels[0];
        enriched.categoryScores = { labels: zs.labels, scores: zs.scores };
        enrichmentSteps.zeroShot = true;
      }
    } catch (err) {
      enrichmentSteps.notes.push(`zero-shot failed: ${err.message}`);
    }
  } else {
    enrichmentSteps.notes.push("skipped zero-shot (no hfApiKey or no text)");
  }

  // NER
  if (keys.hfApiKey && combinedText) {
    try {
      const ner = await hfNER(keys.hfApiKey, combinedText);
      if (Array.isArray(ner)) {
        // pull token text if available
        const nerEntities = ner
          .map((e) => e.word || e.entity || e.entity_group)
          .filter(Boolean)
          .map(String);
        const lowerEntities = nerEntities.map((s) => s.toLowerCase());
        const nerEco = sustainabilityKeywords.filter((kw) =>
          lowerEntities.some((e) => e.includes(kw))
        );
        if (nerEco.length > 0) {
          enriched.ecoAttributes = enriched.ecoAttributes.concat(nerEco);
        }
      }
      enrichmentSteps.ner = true;
    } catch (err) {
      enrichmentSteps.notes.push(`ner failed: ${err.message}`);
    }
  } else {
    enrichmentSteps.notes.push("skipped ner (no hfApiKey or no text)");
  }

  // Keyword-based extraction (local, always run)
  try {
    const lowerText = combinedText.toLowerCase();
    const matches = sustainabilityKeywords.filter((kw) => lowerText.includes(kw));
    if (matches.length > 0) {
      enriched.ecoAttributes = enriched.ecoAttributes.concat(matches);
      enrichmentSteps.keywords = true;
    } else {
      enrichmentSteps.notes.push("no keyword matches");
    }
  } catch (err) {
    enrichmentSteps.notes.push(`keyword extraction failed: ${err.message}`);
  }

  // Image Vision (optional)
  if (keys.googleVisionApiKey && productInfo.images && productInfo.images.length > 0) {
    try {
      const visionData = await googleVisionLabels(keys.googleVisionApiKey, productInfo.images[0]);
      if (visionData && visionData.responses && visionData.responses[0]) {
        const ann = visionData.responses[0];
        if (Array.isArray(ann.labelAnnotations)) {
          const labels = ann.labelAnnotations.map((l) => l.description.toLowerCase());
          enriched.imageLabels = labels;
          const ecoLabelKeywords = [
            "organic",
            "recyclable",
            "recycled",
            "sustainable",
            "bamboo",
            "paper",
            "cardboard",
            "wood",
            "plant",
            "biodegradable",
            "compostable",
          ];
          const matched = labels.filter((lbl) => ecoLabelKeywords.some((kw) => lbl.includes(kw)));
          if (matched.length > 0) {
            enriched.ecoAttributes = enriched.ecoAttributes.concat(matched);
          }
          enrichmentSteps.vision = true;
        }
      }
    } catch (err) {
      enrichmentSteps.notes.push(`vision failed: ${err.message}`);
    }
  } else {
    enrichmentSteps.notes.push("skipped vision (no googleVisionApiKey or no image)");
  }

  // Normalize and dedupe attributes
  enriched.ecoAttributes = Array.from(new Set((enriched.ecoAttributes || []).map((a) => String(a).toLowerCase())));
  return { enriched, enrichmentSteps };
}

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background: Received message", request);

  // Save keys individually as requested
  if (request.action === "saveApiKey") {
    chrome.storage.sync.set({ geminiApiKey: request.apiKey }, () => {
      console.log("Background: Gemini API key saved");
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "saveHfKey") {
    chrome.storage.sync.set({ hfApiKey: request.apiKey }, () => {
      console.log("Background: Hugging Face API key saved");
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "saveVisionKey") {
    chrome.storage.sync.set({ googleVisionApiKey: request.apiKey }, () => {
      console.log("Background: Google Vision API key saved");
      sendResponse({ success: true });
    });
    return true;
  }

  // Get stored keys (single call)
  if (request.action === "getApiKeys") {
    chrome.storage.sync.get(["geminiApiKey", "hfApiKey", "googleVisionApiKey"], (result) => {
      console.log("Background: Retrieved API keys (presence):", {
        gemini: !!result.geminiApiKey,
        hf: !!result.hfApiKey,
        vision: !!result.googleVisionApiKey,
      });
      sendResponse({ keys: result });
    });
    return true;
  }

  // Legacy: findAlternatives (keeps original behavior if someone calls it directly)
  if (request.action === "findAlternatives") {
    (async () => {
      try {
        const keys = await getStoredKeys();
        if (!keys.geminiApiKey) {
          throw new Error("Gemini API key not found. Please configure it in the extension popup.");
        }
        const gemini = new GeminiAPI(keys.geminiApiKey);
        const alternatives = await gemini.findEcoAlternatives(request.productInfo);
        sendResponse({ success: true, alternatives });
      } catch (error) {
        console.error("Background: findAlternatives error:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // NEW: End-to-end enrichment + Gemini -> single call from content script
  if (request.action === "enrichAndFindAlternatives") {
    (async () => {
      try {
        const keys = await getStoredKeys();

        if (!keys.geminiApiKey) {
          // We still proceed with enrichment even if Gemini key missing, but warn.
          console.warn("Background: Gemini API key missing - cannot call Gemini until configured.");
        }

        // Run enrichment pipeline
        const { enriched, enrichmentSteps } = await enrichProductInfoPipeline(request.productInfo, keys);

        // If Gemini key exists, call Gemini
        let alternatives = null;
        let geminiError = null;
        if (keys.geminiApiKey) {
          try {
            const gemini = new GeminiAPI(keys.geminiApiKey);
            alternatives = await gemini.findEcoAlternatives(enriched);
          } catch (err) {
            console.error("Background: Gemini error:", err);
            geminiError = err.message || String(err);
          }
        }

        // Build response
        const resp = {
          success: !!alternatives,
          alternatives: alternatives || { alternatives: [] },
          enrichedProductInfo: enriched,
          enrichmentSteps,
          geminiError,
        };

        console.log("Background: enrichAndFindAlternatives result:", {
          success: resp.success,
          enrichmentSteps,
          geminiError,
        });

        sendResponse(resp);
      } catch (error) {
        console.error("Background: enrichAndFindAlternatives error:", error);
        sendResponse({ success: false, error: error.message || String(error) });
      }
    })();
    return true; // keep the message channel open for async sendResponse
  }

  // Unknown action
  console.warn("Background: Unknown action", request.action);
  sendResponse({ success: false, error: "Unknown action" });
  return false;
});
