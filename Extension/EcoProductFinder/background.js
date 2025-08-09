// Background script for Eco Product Finder
class GeminiAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";
  }

  async generateContent(prompt) {
    try {
      const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
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
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
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
      throw new Error("No valid JSON found in response");
    } catch (error) {
      console.error("Error parsing Gemini response:", error);
      return { alternatives: [] };
    }
  }
}

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background: Received message", request);

  if (request.action === "findAlternatives") {
    handleFindAlternatives(request.productInfo)
      .then((response) => {
        console.log("Background: Sending response", response);
        sendResponse(response);
      })
      .catch((error) => {
        console.error("Background script error:", error);
        sendResponse({ error: error.message });
      });
    return true; // Indicates we will send a response asynchronously
  }

  if (request.action === "saveApiKey") {
    chrome.storage.sync.set({ geminiApiKey: request.apiKey }, () => {
      console.log("Background: API key saved");
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "getApiKey") {
    chrome.storage.sync.get("geminiApiKey", (result) => {
      console.log(
        "Background: Retrieved API key",
        result.geminiApiKey ? "Found" : "Not found"
      );
      sendResponse({ apiKey: result.geminiApiKey });
    });
    return true;
  }
});

async function handleFindAlternatives(productInfo) {
  try {
    // Get API key from storage
    const result = await new Promise((resolve) => {
      chrome.storage.sync.get("geminiApiKey", resolve);
    });

    if (!result.geminiApiKey) {
      throw new Error(
        "Gemini API key not found. Please configure it in the extension popup."
      );
    }

    const gemini = new GeminiAPI(result.geminiApiKey);
    const alternatives = await gemini.findEcoAlternatives(productInfo);

    return { success: true, alternatives };
  } catch (error) {
    console.error("Error finding alternatives:", error);
    return { success: false, error: error.message };
  }
}
