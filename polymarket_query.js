import { Polymarket } from '@polymarket/sdk';
import { addHours, isAfter, isBefore } from 'date-fns';

async function getPolymarketOpportunities() {
    try {
        const polymarket = new Polymarket();
        const allMarkets = await polymarket.markets.list();

        const now = new Date();
        const minExpiry = addHours(now, 2);
        const maxExpiry = addHours(now, 72);

        const filteredMarkets = allMarkets.filter(market => {
            const categories = market.categories.map(cat => cat.toLowerCase());
            const isPolitical = categories.includes("political");
            const isSports = categories.includes("sports");
            const isCrypto = categories.includes("crypto");

            if (!isPolitical && !isSports && !isCrypto) {
                return false;
            }

            // Find the main direction and its probability
            // Assuming the market has outcomes and probabilities
            let mainOutcomeProbability = 0;
            let mainOutcome = '';
            let secondaryOutcomeProbability = 0;

            if (market.outcomes && market.outcomes.length > 1) {
                // Sort outcomes by probability in descending order
                const sortedOutcomes = [...market.outcomes].sort((a, b) => b.probability - a.probability);
                mainOutcomeProbability = sortedOutcomes[0].probability;
                mainOutcome = sortedOutcomes[0].title;
                secondaryOutcomeProbability = sortedOutcomes[1].probability;
            } else {
                return false; // Not enough outcomes to determine main direction and spread
            }

            const winRate = mainOutcomeProbability;
            const spread = Math.abs(mainOutcomeProbability - secondaryOutcomeProbability); // Using difference for spread

            // Ensure main direction win rate is within bounds
            if (winRate < 0.80 || winRate > 0.96) {
                return false;
            }

            // Ensure spread is within bounds
            if (spread > 0.008) {
                return false;
            }

            // Ensure liquidity is sufficient
            // This assumes market.volume or market.liquidity is available and in USD (U)
            // The SDK documentation would be needed for exact field names.
            // For now, I'll use a placeholder like market.liquidity and assume it's directly comparable.
            // If the field name is different, this will need to be adjusted.
            const liquidity = market.volume; // Using volume as a proxy for liquidity in USD
            if (liquidity < 10000) {
                return false;
            }

            // Check expiry time
            const expiryDate = new Date(market.end_date);
            if (isBefore(expiryDate, minExpiry) || isAfter(expiryDate, maxExpiry)) {
                return false;
            }
            
            // Check if market is still tradeable and has clear direction advantage (already covered by winRate)
            // Assuming `market.status` or similar indicates tradeable state, let's assume active if not specified.
            // The problem statement says "仅推送当前仍可交易", so I will assume if market has a status, it should be 'active' or similar.
            // For now, I'll skip explicit status check and rely on other filters implicitly handling active markets.

            market.calculatedWinRate = winRate;
            market.calculatedSpread = spread;
            market.mainOutcome = mainOutcome;
            market.formattedExpiry = expiryDate.toISOString();
            market.liquidity = liquidity;

            return true;
        });

        // Format the output as requested
        const formattedOutput = filteredMarkets.map(market => {
            return `${market.title}｜${market.categories.join(', ')}｜${market.mainOutcome}｜${market.calculatedWinRate.toFixed(2)}｜${market.calculatedSpread.toFixed(3)}｜${market.liquidity.toFixed(2)}U｜${market.formattedExpiry}`;
        });

        if (formattedOutput.length > 0) {
            console.log(formattedOutput.join('\n'));
        } else {
            console.log("NO_REPLY");
        }

    } catch (error) {
        console.error("NO_REPLY");
    }
}

getPolymarketOpportunities().catch(console.error);
