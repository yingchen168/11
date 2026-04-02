
const { Polymarket } = require('@polymarket/sdk');
const { ethers } = require('ethers');

// Initialize Polymarket SDK
const polymarket = new Polymarket();

async function getOpportunities() {
    try {
        const markets = await polymarket.getAllMarkets();
        const opportunities = [];
        const now = Date.now();

        for (const market of markets) {
            const { conditions, category, creationTime, closeTime, status } = market;

            // Skip markets that are not open or resolved
            if (status !== 'Open' && status !== 'Resolved') {
                continue;
            }

            // Filter by category
            const lowerCaseCategory = category.toLowerCase();
            if (!['politics', 'sports', 'crypto'].includes(lowerCaseCategory)) {
                continue;
            }

            for (const condition of conditions) {
                const { outcomeProbabilities, liquidity, scalarMin, scalarMax } = condition;

                // Ensure outcomeProbabilities is not empty
                if (!outcomeProbabilities || outcomeProbabilities.length === 0) {
                    continue;
                }

                // Calculate expiry time
                const expiryTime = closeTime ? new Date(closeTime).getTime() : new Date(creationTime).getTime() + 72 * 60 * 60 * 1000; // Fallback to 72 hours from creation if closeTime is missing
                const timeToExpiryHours = (expiryTime - now) / (1000 * 60 * 60);

                // Filter by time to expiry
                if (timeToExpiryHours < 2 || timeToExpiryHours > 72) {
                    continue;
                }

                // Sort probabilities to find the main direction
                const sortedProbabilities = [...outcomeProbabilities].sort((a, b) => b.value - a.value);
                const mainDirection = sortedProbabilities[0];

                // Filter by win probability
                if (mainDirection.value < 0.80 || mainDirection.value > 0.96) {
                    continue;
                }

                // Calculate spread (difference between top two probabilities)
                let spread = 0;
                if (sortedProbabilities.length >= 2) {
                    spread = mainDirection.value - sortedProbabilities[1].value;
                } else if (sortedProbabilities.length === 1) {
                    // If there's only one outcome, the "spread" against a hypothetical second outcome is 1 - mainDirection.value
                    spread = 1 - mainDirection.value;
                }

                // Filter by spread
                if (spread > 0.008) {
                    continue;
                }

                // Filter by liquidity
                if (parseFloat(liquidity) < 10000) {
                    continue;
                }

                // Determine direction
                const direction = mainDirection.outcome;

                opportunities.push({
                    market: market.question,
                    category: category,
                    direction: direction,
                    winProbability: mainDirection.value,
                    spread: spread,
                    liquidity: parseFloat(liquidity),
                    expiryTime: new Date(expiryTime).toUTCString()
                });
            }
        }

        if (opportunities.length > 0) {
            let output = '';
            for (const opp of opportunities) {
                output += `${opp.market} | ${opp.category} | ${opp.direction} | ${opp.winProbability.toFixed(4)} | ${opp.spread.toFixed(4)} | ${opp.liquidity.toFixed(2)}U | ${opp.expiryTime}\n`;
            }
            console.log(output);
        } else {
            console.log('NO_REPLY');
        }

    } catch (error) {
        console.error('Error fetching Polymarket opportunities:', error);
        console.log('NO_REPLY'); // Return NO_REPLY on error
    }
}

getOpportunities();
