import puppeteer from "puppeteer";

const CITY_IDS = {
  islamabad: "3",
  lahore: "1",
  karachi: "2",
  rawalpindi: "41",
  peshawar: "17",
  faisalabad: "16",
  multan: "15",
  quetta: "40",
};

const formatPropertyType = (type) => {
  const value = String(type || "house").toLowerCase();

  if (value.includes("apartment") || value.includes("flat")) {
    return "Flats_Apartments";
  }

  if (value.includes("plot")) {
    return "Plots";
  }

  if (value.includes("commercial")) {
    return "Commercial_Properties";
  }

  return "Houses_Property";
};

export const scrapeListings = async (
  city = "islamabad",
  type = "house"
) => {
  let browser;

  try {
    const cityKey = String(city).toLowerCase().trim();
    const cityId = CITY_IDS[cityKey];

    if (!cityId) {
      console.log("[Scraper] Unknown city:", city);
      return [];
    }

    const propertyType = formatPropertyType(type);

    const cityName =
      cityKey.charAt(0).toUpperCase() + cityKey.slice(1);

    const url =
      "https://www.zameen.com/" +
      propertyType +
      "/" +
      cityName +
      "-" +
      cityId +
      "-1.html";

    console.log("[Scraper] Accessing:", url);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });

    const page = await browser.newPage();

    await page.setRequestInterception(true);

    page.on("request", (request) => {
      const resourceType = request.resourceType();

      if (
        resourceType === "media" ||
        resourceType === "font" ||
        resourceType === "stylesheet"
      ) {
        request.abort();
      } else {
        request.continue();
      }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const listings = await page.evaluate(() => {
      const elements = Array.from(
        document.querySelectorAll(
          '[data-testid="listing-card"], article, [class*="listing"]'
        )
      );

      const results = [];

      for (const element of elements) {
        const text = element.innerText || "";

        if (!text.trim()) {
          continue;
        }

        const links = Array.from(
          element.querySelectorAll("a")
        );

        const propertyLink = links.find((link) => {
          const href = link.href || "";

          return href.includes(
            "zameen.com/Property/"
          );
        });

        if (!propertyLink) {
          continue;
        }

        const images = Array.from(
          element.querySelectorAll("img")
        );

        const image = images.find((img) => {
          const src =
            img.getAttribute("src") ||
            img.getAttribute("data-src") ||
            img.getAttribute("data-original");

          return src && src.startsWith("http");
        });

        const title =
          element.querySelector("h2")?.innerText ||
          element.querySelector("h3")?.innerText ||
          propertyLink.innerText ||
          "Property";

        /*
         * PRICE
         *
         * Look specifically after PKR so that
         * numbers such as "20" from badges are
         * not mistaken for the price.
         */

        const priceMatch = text.match(
          /PKR\s*([\d,.]+)\s*(Crore|Lakh|Million|Thousand)?/i
        );

        let extractedPrice = "Price not available";

        if (priceMatch) {
          extractedPrice =
            priceMatch[1] +
            (priceMatch[2]
              ? " " + priceMatch[2]
              : "");
        }

        /*
         * BEDROOMS
         *
         * First try explicit text:
         * "4 Bedrooms", "4 Beds"
         */

        const bedroomTextMatch = text.match(
          /(\d+)\s*(?:Beds?|Bedrooms?)/i
        );

        /*
         * BATHROOMS
         *
         * First try explicit text:
         * "4 Bathrooms", "4 Baths"
         */

        const bathroomTextMatch = text.match(
          /(\d+)\s*(?:Baths?|Bathrooms?)/i
        );

        let extractedBedrooms = bedroomTextMatch
          ? Number(bedroomTextMatch[1])
          : 0;

        let extractedBathrooms = bathroomTextMatch
          ? Number(bathroomTextMatch[1])
          : 0;

        /*
         * Zameen often displays bedrooms and
         * bathrooms as two numbers immediately
         * before the area.
         *
         * Example:
         *
         * 4
         * 4
         * 350 Sq. Yd.
         *
         * Therefore, use the two numbers before
         * the area as a fallback.
         */

        const lines = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);

        const areaIndex = lines.findIndex((line) =>
          /Sq\.?\s*(?:Yd|Ft)|Kanal|Marla/i.test(line)
        );

        if (areaIndex >= 2) {
          const possibleBedrooms = Number(
            lines[areaIndex - 2]
          );

          const possibleBathrooms = Number(
            lines[areaIndex - 1]
          );

          if (
            extractedBedrooms === 0 &&
            Number.isInteger(possibleBedrooms) &&
            possibleBedrooms >= 1 &&
            possibleBedrooms <= 20
          ) {
            extractedBedrooms = possibleBedrooms;
          }

          if (
            extractedBathrooms === 0 &&
            Number.isInteger(possibleBathrooms) &&
            possibleBathrooms >= 1 &&
            possibleBathrooms <= 20
          ) {
            extractedBathrooms = possibleBathrooms;
          }
        }

        /*
         * AREA
         */

        const areaMatch = text.match(
          /([\d,.]+)\s*(?:Sq\.?\s*(?:Yd|Ft)|Kanal|Marla)/i
        );

        results.push({
          rawId: propertyLink.href,

          rawTitle: title.trim(),

          rawPrice: extractedPrice,

          rawLocation: text
            .trim()
            .slice(0, 150),

          rawLink: propertyLink.href,

          rawImage: image
            ? image.getAttribute("src") ||
              image.getAttribute("data-src") ||
              image.getAttribute("data-original")
            : "",

          rawBedrooms: extractedBedrooms,

          rawBathrooms: extractedBathrooms,

          rawArea: areaMatch
            ? areaMatch[0].trim()
            : "",
        });
      }

      return results;
    });

    console.log(
      "[Scraper] Extracted",
      listings.length,
      "listings"
    );

    if (listings.length > 0) {
      console.log(
        "[Scraper] First listing:",
        JSON.stringify(
          listings[0],
          null,
          2
        )
      );
    }

    return listings;
  } catch (error) {
    console.error(
      "[Scraper] Error:",
      error.message
    );

    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
