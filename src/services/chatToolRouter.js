import {
  searchAttractionExactPoi,
  searchAttractionsBroadDiscovery,
  searchAttractionsNearbyAroundPoi,
} from "./attractionsSearchService.js";
import { resolveNamedPlace } from "./placeResolver.js";
import { generatePlanOutline } from "../utils/planOutline.js";

function buildActionCard({ id, label, endpoint, payload }) {
  return {
    type: "action",
    id,
    label,
    endpoint,
    method: "POST",
    payload: payload || {},
  };
}

export async function routeChatTools({ classification, memory, latestUserMessage, logger }) {
  const mode = classification?.mode || "travel_knowledge";
  const task = classification?.task || "answer_general_travel_question";

  const destinationHint =
    classification?.destinationHint ||
    classification?.location ||
    memory?.destination?.label ||
    null;

  const baseContext = {
    mode,
    task,
    destinationHint,
    userQuery: classification?.query || latestUserMessage || null,
    fallbackNotes: [],
  };

  try {
    if (mode === "destination_discovery") {
      const data = await searchAttractionsBroadDiscovery({ destinationHint });
      return {
        toolContext: {
          ...baseContext,
          resolvedDestination: data.resolvedDestination,
          attractionResults: data.attractions,
          fallbackNotes: data.notes || [],
        },
        cards: data.cards || [],
        resolvedContext: {
          destination: data.resolvedDestination
            ? {
                label: data.resolvedDestination.label || destinationHint,
                country_code: data.resolvedDestination.countryCode || null,
                place_type: data.resolvedDestination.type || "unknown",
                lat: data.resolvedDestination.lat ?? null,
                lng: data.resolvedDestination.lng ?? null,
                confidence: 0.82,
              }
            : null,
        },
      };
    }

    if (mode === "place_lookup") {
      const query = classification?.query || latestUserMessage;
      const resolvedPlace = await resolveNamedPlace({ query, destinationHint });
      const data = await searchAttractionExactPoi({
        query,
        destinationHint: destinationHint || resolvedPlace?.city || null,
      });

      return {
        toolContext: {
          ...baseContext,
          resolvedPlace,
          resolvedDestination: data.resolvedDestination,
          attractionResults: data.attractions,
          fallbackNotes: data.notes || [],
        },
        cards: data.cards || [],
        resolvedContext: {
          active_place: resolvedPlace,
          destination: data.resolvedDestination
            ? {
                label: data.resolvedDestination.label || destinationHint,
                country_code: data.resolvedDestination.countryCode || null,
                place_type: data.resolvedDestination.type || "unknown",
                lat: data.resolvedDestination.lat ?? null,
                lng: data.resolvedDestination.lng ?? null,
                confidence: 0.78,
              }
            : null,
        },
      };
    }

    if (mode === "nearby_search") {
      const placeQuery = classification?.query || memory?.active_place?.label || latestUserMessage;
      const resolvedPlace = await resolveNamedPlace({
        query: placeQuery,
        destinationHint: destinationHint || memory?.active_place?.city || null,
      });

      const data = await searchAttractionsNearbyAroundPoi({
        resolvedPlace: resolvedPlace || memory?.active_place || null,
        destinationHint: destinationHint || resolvedPlace?.city || null,
      });

      return {
        toolContext: {
          ...baseContext,
          resolvedPlace: resolvedPlace || memory?.active_place || null,
          resolvedDestination: data.resolvedDestination,
          attractionResults: data.attractions,
          fallbackNotes: data.notes || [],
        },
        cards: data.cards || [],
        resolvedContext: {
          active_place: resolvedPlace || memory?.active_place || null,
          destination: data.resolvedDestination
            ? {
                label: data.resolvedDestination.label || destinationHint,
                country_code: data.resolvedDestination.countryCode || null,
                place_type: data.resolvedDestination.type || "unknown",
                lat: data.resolvedDestination.lat ?? null,
                lng: data.resolvedDestination.lng ?? null,
                confidence: 0.8,
              }
            : null,
        },
      };
    }

    if (mode === "trip_planning") {
      const outline = await generatePlanOutline({
        promptText: latestUserMessage,
        destinationLabel: destinationHint || memory?.destination?.label || "",
        startDate: memory?.dates?.start_date || null,
        endDate: memory?.dates?.end_date || null,
        budget: memory?.budget || null,
        vibe: memory?.vibe || [],
        travelers: memory?.travelers || null,
      });

      const highlights = Array.isArray(outline?.highlights) ? outline.highlights.slice(0, 5) : [];
      const cards = outline
        ? [
            {
              type: "plan_outline",
              title: outline?.title || "Trip Outline",
              destination: outline?.destinationLabel || destinationHint || null,
              highlights,
              days: outline?.days || [],
            },
          ]
        : [];

      return {
        toolContext: {
          ...baseContext,
          planningOutput: outline,
          fallbackNotes: outline ? [] : ["Could not generate planning output from tools."],
        },
        cards,
        resolvedContext: {
          destination: outline?.destinationLabel
            ? {
                label: outline.destinationLabel,
                country_code: null,
                place_type: "unknown",
                lat: null,
                lng: null,
                confidence: 0.72,
              }
            : null,
        },
      };
    }

    if (mode === "travel_action") {
      const actions = [];
      if (task === "show_flights") {
        actions.push(
          buildActionCard({
            id: "show_flights",
            label: "Find flights",
            endpoint: "/api/flights/search",
            payload: {
              from: memory?.origin?.label || null,
              to: memory?.destination?.label || destinationHint || null,
              dates: memory?.dates || null,
            },
          })
        );
      }
      if (task === "compare_hotels") {
        actions.push(
          buildActionCard({
            id: "compare_hotels",
            label: "Compare hotels",
            endpoint: "/api/hotels/search",
            payload: {
              destination: memory?.destination?.label || destinationHint || null,
              dates: memory?.dates || null,
            },
          })
        );
      }
      if (task === "save_place") {
        actions.push(
          buildActionCard({
            id: "save_place",
            label: "Save place",
            endpoint: "/api/saved/items",
            payload: {
              thread_id: null,
              place: memory?.active_place || null,
            },
          })
        );
      }

      return {
        toolContext: {
          ...baseContext,
          travelActions: actions,
          fallbackNotes: actions.length ? [] : ["No executable action matched this request."],
        },
        cards: actions,
        resolvedContext: {},
      };
    }

    return {
      toolContext: baseContext,
      cards: [],
      resolvedContext: {},
    };
  } catch (error) {
    logger?.warn?.({ error, mode, task }, "chat tool routing failed");
    return {
      toolContext: {
        ...baseContext,
        fallbackNotes: ["Tool routing failed. Use travel knowledge fallback response."],
      },
      cards: [],
      resolvedContext: {},
    };
  }
}
