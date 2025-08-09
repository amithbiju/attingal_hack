// Content script for analyzing Amazon pages (uses background for enrichment+Gemini)
(function () {
  "use strict";

  class AmazonPageAnalyzer {
    constructor() {
      this.sidebarInjected = false;
      this.currentProductInfo = null;
      this.initialized = false;
      console.log("Eco Finder: Class instantiated");
    }

    // Keep scraping logic exactly the same
    extractProductInfo() {
      const productInfo = {
        title: "",
        category: "",
        price: "",
        description: "",
        images: [],
        url: window.location.href,
      };

      // Extract title
      const titleSelectors = [
        "#productTitle",
        '[data-automation-id="title"]',
        ".product-title",
        'h1[class*="title"]',
      ];

      for (const selector of titleSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          productInfo.title = element.textContent.trim();
          break;
        }
      }

      // Extract price
      const priceSelectors = [
        ".a-price-whole",
        '[class*="price"] .a-offscreen',
        ".a-price .a-offscreen",
        '[data-automation-id="price"]',
      ];

      for (const selector of priceSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          productInfo.price = element.textContent.trim();
          break;
        }
      }

      // Extract category from breadcrumb
      const breadcrumbSelectors = [
        "#wayfinding-breadcrumbs_feature_div a",
        ".nav-progressive-attribute",
        '[data-automation-id="breadcrumb"] a',
      ];

      for (const selector of breadcrumbSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          const categories = Array.from(elements)
            .map((el) => el.textContent.trim())
            .filter((text) => text && text !== "Amazon.com");
          productInfo.category = categories.join(" > ");
          break;
        }
      }

      // Extract description
      const descSelectors = [
        "#feature-bullets ul",
        '[data-automation-id="productDescription"]',
        "#productDescription",
        ".product-description",
      ];

      for (const selector of descSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          productInfo.description = element.textContent
            .trim()
            .substring(0, 500);
          break;
        }
      }

      // Extract main product image
      const imageSelectors = [
        "#landingImage",
        "#main-image",
        '[data-automation-id="productImage"] img',
      ];

      for (const selector of imageSelectors) {
        const element = document.querySelector(selector);
        if (element && element.src) {
          productInfo.images.push(element.src);
          break;
        }
      }

      return productInfo;
    }

    // Other UI methods (sidebar, fab, displayAlternatives) remain unchanged
    isProductPage() {
      const productIndicators = [
        "#productTitle",
        '[data-automation-id="title"]',
        "#add-to-cart-button",
        "#buy-now-button",
        'h1[id*="title"]',
        "[data-asin]",
        ".product-title",
        "#dp-container",
      ];

      const isProductPage = productIndicators.some((selector) =>
        document.querySelector(selector)
      );
      console.log(
        "Eco Finder: Product page detection:",
        isProductPage,
        window.location.href
      );
      return isProductPage;
    }

    createSidebar() {
      if (this.sidebarInjected) return;

      const sidebar = document.createElement("div");
      sidebar.id = "eco-finder-sidebar";
      sidebar.innerHTML = `
      <div id="eco-sidebar-header">
        <h3>🌱 Eco Alternatives</h3>
        <button id="eco-sidebar-close">×</button>
      </div>
      <div id="eco-sidebar-content">
        <div id="eco-loading" style="display: none;">
          <div class="eco-spinner"></div>
          <p>Finding eco-friendly alternatives...</p>
        </div>
        <div id="eco-results"></div>
        <button id="eco-find-btn">Find Eco Alternatives</button>
      </div>
    `;

      document.body.appendChild(sidebar);
      this.sidebarInjected = true;

      // Add event listeners
      document
        .getElementById("eco-sidebar-close")
        .addEventListener("click", () => {
          sidebar.style.right = "-350px";
        });

      document.getElementById("eco-find-btn").addEventListener("click", () => {
        this.findAlternatives();
      });
    }

    showSidebar() {
      const sidebar = document.getElementById("eco-finder-sidebar");
      if (sidebar) {
        sidebar.style.right = "0px";
      }
    }

    // Now calls background 'enrichAndFindAlternatives' so enrichment & Gemini are centralized
    async findAlternatives() {
      const loadingDiv = document.getElementById("eco-loading");
      const resultsDiv = document.getElementById("eco-results");
      const findBtn = document.getElementById("eco-find-btn");

      if (!this.currentProductInfo || !this.currentProductInfo.title) {
        console.log("Eco Finder: Re-extracting product info...");
        this.currentProductInfo = this.extractProductInfo();
      }

      if (!this.currentProductInfo || !this.currentProductInfo.title) {
        console.log("Eco Finder: No product detected, using test data");
        this.currentProductInfo = {
          title: "Generic Product for Testing",
          category: "General",
          price: "$20-50",
          description:
            "Test product to demonstrate eco alternatives functionality",
          url: window.location.href,
        };
      }

      console.log(
        "Eco Finder: Searching for alternatives for:",
        this.currentProductInfo
      );

      loadingDiv.style.display = "block";
      findBtn.disabled = true;
      resultsDiv.innerHTML = "";

      try {
        // Single end-to-end call to background
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              action: "enrichAndFindAlternatives",
              productInfo: this.currentProductInfo,
            },
            resolve
          );
        });

        console.log("Eco Finder: Background response:", response);

        // console-visible fallback info: enrichment steps applied
        if (response && response.enrichmentSteps) {
          console.info("Eco Finder: enrichmentSteps:", response.enrichmentSteps);
        }

        loadingDiv.style.display = "none";
        findBtn.disabled = false;

        if (
          response.success &&
          response.alternatives &&
          response.alternatives.alternatives
        ) {
          // If enriched info available, update local reference (useful for debugging)
          if (response.enrichedProductInfo) {
            this.currentProductInfo = response.enrichedProductInfo;
          }
          this.displayAlternatives(response.alternatives.alternatives);
        } else {
          // If Gemeni failed but enrichment succeeded, still show a helpful message
          const errorMsg = response.error || response.geminiError || "Could not find alternatives";
          const enrichedNote = response.enrichedProductInfo
            ? " (enrichment succeeded — see console.enrichedProductInfo)"
            : "";
          resultsDiv.innerHTML = `<p class="eco-error">Error: ${errorMsg}${enrichedNote}</p>`;
          if (response.enrichedProductInfo) {
            console.log("Eco Finder: Enriched product info available:", response.enrichedProductInfo);
          }
        }
      } catch (error) {
        console.error("Eco Finder: Error finding alternatives:", error);
        loadingDiv.style.display = "none";
        findBtn.disabled = false;
        resultsDiv.innerHTML = `<p class="eco-error">Error: ${error.message}</p>`;
      }
    }

    displayAlternatives(alternatives) {
      const resultsDiv = document.getElementById("eco-results");

      if (!alternatives || alternatives.length === 0) {
        resultsDiv.innerHTML =
          '<p class="eco-no-results">No eco alternatives found for this product.</p>';
        return;
      }

      const alternativesHtml = alternatives
        .map(
          (alt, index) => `
      <div class="eco-alternative">
        <h4>${alt.name}</h4>
        <p class="eco-description">${alt.description}</p>
        <div class="eco-features">
          ${
            alt.ecoFeatures
              ? alt.ecoFeatures
                  .map((feature) => `<span class="eco-tag">${feature}</span>`)
                  .join("")
              : ""
          }
        </div>
        <div class="eco-price">Estimated: ${alt.estimatedPrice || "N/A"}</div>
        <a href="${alt.amazonSearchUrl}" target="_blank" class="eco-buy-btn">
          🛒 Search on Amazon
        </a>
      </div>
    `
        )
        .join("");

      resultsDiv.innerHTML = alternativesHtml;
    }

    init() {
      if (this.initialized) {
        console.log("Eco Finder: Already initialized, skipping");
        return;
      }

      console.log("Eco Finder: Initializing on", window.location.href);
      this.initialized = true;

      this.createFloatingButton();

      if (this.isProductPage()) {
        this.currentProductInfo = this.extractProductInfo();
        this.createSidebar();
        console.log("Eco Finder: Product detected", this.currentProductInfo);
      } else {
        console.log(
          "Eco Finder: Not a product page, but button still available for testing"
        );
        this.createSidebar();
      }
    }

    createFloatingButton() {
      if (document.getElementById("eco-finder-fab")) {
        console.log("Eco Finder: Floating button already exists");
        return;
      }

      const button = document.createElement("div");
      button.id = "eco-finder-fab";
      button.innerHTML = "🌱";
      button.title = "Find Eco Alternatives";

      button.style.cssText = `
      position: fixed !important;
      bottom: 30px !important;
      right: 30px !important;
      width: 60px !important;
      height: 60px !important;
      background: linear-gradient(135deg, #4CAF50, #45a049) !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 24px !important;
      cursor: pointer !important;
      box-shadow: 0 4px 16px rgba(76, 175, 80, 0.3) !important;
      z-index: 999999 !important;
      transition: all 0.3s ease !important;
      border: none !important;
      margin: 0 !important;
      padding: 0 !important;
    `;

      button.addEventListener("click", () => {
        console.log("Eco Finder: Floating button clicked");
        this.showSidebar();
      });

      button.addEventListener("mouseenter", () => {
        button.style.transform = "scale(1.1) translateY(-2px)";
      });

      button.addEventListener("mouseleave", () => {
        button.style.transform = "scale(1)";
      });

      document.body.appendChild(button);
      console.log("Eco Finder: Floating button added to page");
    }
  }

  function initializeEcoFinder() {
    try {
      console.log("Eco Finder: Attempting initialization...");
      const analyzer = new AmazonPageAnalyzer();
      analyzer.init();
      console.log("Eco Finder: Initialization completed");
    } catch (error) {
      console.error("Eco Finder: Initialization error:", error);
    }
  }

  console.log("Eco Finder: Content script loaded");

  setTimeout(() => {
    console.log("Eco Finder: Immediate initialization attempt");
    initializeEcoFinder();
  }, 100);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      console.log("Eco Finder: DOM ready initialization");
      initializeEcoFinder();
    });
  } else {
    console.log("Eco Finder: DOM already ready, initializing...");
    setTimeout(initializeEcoFinder, 500);
  }

  window.addEventListener("load", () => {
    console.log("Eco Finder: Window load initialization");
    setTimeout(initializeEcoFinder, 1000);
  });

  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      console.log("Eco Finder: URL changed to", url);
      setTimeout(() => {
        if (window.ecoAnalyzer) {
          window.ecoAnalyzer.initialized = false;
        }
        initializeEcoFinder();
      }, 1500);
    }
  }).observe(document, { subtree: true, childList: true });

  window.ecoAnalyzer = null;
  setTimeout(() => {
    window.ecoAnalyzer = new AmazonPageAnalyzer();
    console.log("Eco Finder: Global analyzer created for debugging");
  }, 2000);
})(); // End of IIFE
