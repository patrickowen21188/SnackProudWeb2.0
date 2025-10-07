// --- CORE CONFIGURATION ---
const API_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent";
const API_KEY = ""; // !!! IMPORTANT: YOU MUST ADD YOUR API KEY HERE !!!

// !!! CRITICAL: GOOGLE SHEETS URL
// Replace 'YOUR_SHEET_ID' with your actual Google Sheet ID
const GOOGLE_SHEETS_URL = 'https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/gviz/tq?tqx=out:csv&sheet=Sheet1'; 

const SP_COLORS = {
    yellow: '#fdcf14', orange: '#db7f05', teal: '#2290ab', magenta: '#bf247a',
    darkGreen: '#3d6b5e', lightCream: '#faf5e5', textDark: '#333333', textLight: '#FFFFFF',
};

const FONT_PRIMARY = 'font-poppins';
const FONT_SECONDARY = 'font-montserrat'; 

const FILTER_OPTIONS = ["Vegan", "Vegetarian", "Keto-Friendly", "Gluten-Free", "Dairy-Free", "Nuts-Free", "Soy-Free", "Eggs-Free", "Sesame-Free", "Sugar-Free", "Corn-Free", "Organic"];
const SNACK_TYPE_OPTIONS = ["Sweet", "Savoury", "Bulk Snack", "Portion Control"];

// --- GLOBAL STATE ---
let userId = null;
let isFormSubmitted = false;
let isLoading = false;
let chatHistory = [];
let lastRecommendationsData = null;
let isContactPrompted = false;
let userData = {
    name: '', email: '', budgetAmount: '', budgetFrequency: 'week', budgetType: 'total', 
    headcount: '', dietaryFilters: [], selectedSnackTypes: SNACK_TYPE_OPTIONS,
};

// --- TOOL DECLARATION ---
const RECOMMEND_SNACKS_DECLARATION = {
    name: "run_recommendation_engine",
    description: "Triggers the full snack recommendation process after all user details have been provided.",
    parameters: { type: "OBJECT", properties: {}, required: [] } 
};

// --- UTILITIES ---
function updateState(key, value) {
    if (key === 'isLoading') isLoading = value;
    else if (key === 'isFormSubmitted') isFormSubmitted = value;
    else if (key === 'chatHistory') chatHistory = value;
    else if (key === 'lastRecommendationsData') lastRecommendationsData = value;
    else if (key === 'isContactPrompted') isContactPrompted = value;
    renderChatbotAgent();
}

function scrollChatToBottom() {
    const messagesEnd = document.getElementById('messages-end');
    if (messagesEnd) messagesEnd.scrollIntoView({ behavior: "smooth" });
}

function parseCSV(csvText) {
    if (!csvText) return [];
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) return [];

    const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
    const products = [];
    
    if (!headers.includes('name') || !headers.includes('price') || !headers.includes('category')) {
        console.error("CSV Headers missing mandatory fields: name, price, or category.");
        return [];
    }

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        if (values.length !== headers.length) continue;

        const productData = {};
        headers.forEach((header, index) => {
            productData[header] = values[index];
        });

        products.push({
            id: i,
            name: productData.name,
            price: parseFloat(productData.price) || 0,
            category: productData.category,
            allergens: productData.allergens ? productData.allergens.split(';').map(a => a.trim()) : [],
            servings: parseInt(productData.servings) || 1,
            min_order: parseInt(productData.min_order) || 1,
            image_url: productData.image_url || `https://placehold.co/100x100/A9A9A9/ffffff?text=${productData.name.substring(0,4)}`,
            product_url: productData.product_url || '#',
            dietary: {
                vegan: productData.vegan?.toLowerCase() === 'true',
                gluten_free: productData.gluten_free?.toLowerCase() === 'true',
                keto_friendly: productData.keto_friendly?.toLowerCase() === 'true',
                organic: productData.organic?.toLowerCase() === 'true',
            },
        });
    }
    return products;
}

// --- CORE BUSINESS LOGIC ---
async function fetchLiveProducts() {
    if (GOOGLE_SHEETS_URL.includes('YOUR_SHEET_ID')) {
        console.warn("Using mock data as Google Sheets URL is a placeholder.");
        return [
            { id: 1, name: "Salted Caramel Protein Ball", price: 2.50, category: "Sweet", allergens: ["Nuts", "Dairy"], dietary: { vegan: false, gluten_free: false }, servings: 1, min_order: 10, image_url: "https://placehold.co/100x100/f3d25d/3d6b5e?text=PB", product_url: "#" },
            { id: 2, name: "Sea Salt & Vinegar Chips (GF)", price: 3.00, category: "Savoury", allergens: [], dietary: { vegan: true, gluten_free: true }, servings: 1, min_order: 10, image_url: "https://placehold.co/100x100/e58a70/ffffff?text=Chips", product_url: "#" },
        ];
    }
    try {
        const response = await fetch(GOOGLE_SHEETS_URL);
        if (!response.ok) throw new Error(`Google Sheets fetch error: ${response.statusText}`);
        const csvText = await response.text();
        const products = parseCSV(csvText);
        if (products.length === 0) throw new Error("Parsed product list is empty.");
        return products;
    } catch (error) {
        console.error("Failed to fetch from Google Sheets, using mock data.", error);
        return [ /* Mock data as fallback */ ];
    }
}

async function recommend_snacks({ budgetAmount: budgetAmountInput, budgetType, headcount, snack_type_selection, selected_filters }) {
    const liveProducts = await fetchLiveProducts();
    if (!liveProducts || liveProducts.length === 0) return "CRITICAL ERROR: Failed to retrieve products.";
    
    const headcountInt = parseInt(headcount);
    const budgetAmount = parseFloat(budgetAmountInput);
    let effectiveTotalBudget = budgetType === 'per_head' ? budgetAmount * headcountInt : budgetAmount;

    const snackTypes = snack_type_selection.map(s => s.toLowerCase().replace(/[\s-]/g, '_'));
    const filteredByCategory = liveProducts.filter(p => {
        const productCategoryKey = p.category.toLowerCase().replace(/[\s-]/g, '_');
        return snackTypes.some(st => productCategoryKey.includes(st));
    });

    const finalFiltered = filteredByCategory.filter(product => {
        for (const filter of selected_filters) {
            const lowerFilter = filter.toLowerCase();
            if (lowerFilter.endsWith('-free')) {
                const baseAllergen = filter.substring(0, filter.indexOf('-')).trim();
                if (product.allergens.map(a => a.toLowerCase()).includes(baseAllergen.toLowerCase())) {
                    return false;
                }
                const dietaryKey = lowerFilter.replace(/-/g, '_');
                if (product.dietary[dietaryKey] === false) { 
                    return false;
                }
            } else {
                const dietaryKey = lowerFilter.replace(/-/g, '_');
                if (product.dietary[dietaryKey] !== true) {
                    return false;
                }
            }
        }
        return true;
    });
    
    if (finalFiltered.length === 0) return "No suitable products found after applying your filters.";

    let remainingBudget = effectiveTotalBudget;
    const finalRecommendations = [];
    let totalCost = 0;
    finalFiltered.sort((a,b) => a.price - b.price);

    for (const snack of finalFiltered) {
        if(remainingBudget < snack.price) continue;
        let quantity = Math.ceil(headcountInt / snack.servings);
        quantity = Math.max(quantity, snack.min_order);
        
        if (snack.price * quantity <= remainingBudget) {
            finalRecommendations.push({ ...snack, quantity, total_item_cost: snack.price * quantity });
            remainingBudget -= snack.price * quantity;
            totalCost += snack.price * quantity;
        }
    }
    
    if (finalRecommendations.length === 0) return "Could not fit any items within the budget.";

    return {
        recommendations: finalRecommendations,
        summary: `Found ${finalRecommendations.length} items costing $${totalCost.toFixed(2)}.`,
    };
}

async function executeToolCall(toolCall) {
    if (toolCall.name === 'run_recommendation_engine') {
        const result = await recommend_snacks(userData);
        return { tool_output: { result } };
    }
    return { tool_output: { result: "Error: Unknown function." } };
}

// --- CHATBOT CORE LOGIC ---
function displayResponse(fullText) {
    const newHistory = [...chatHistory, { role: 'model', text: fullText }];
    updateState('chatHistory', newHistory);
    setTimeout(scrollChatToBottom, 10);
}

async function handleApiCall(currentContents) {
    let retryDelay = 1000;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const response = await fetch(`${API_URL_BASE}?key=${API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: currentContents, tools: [{ functionDeclarations: [RECOMMEND_SNACKS_DECLARATION] }] }),
            });
            if (response.status === 429) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                retryDelay *= 2;
                continue;
            }
            if (!response.ok) throw new Error(`API error: ${response.statusText}`);
            return await response.json();
        } catch (error) {
            if (attempt === 4) throw error;
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            retryDelay *= 2;
        }
    }
}

async function handleRecommendationRun(initialHistory) {
    updateState('isLoading', true);
    updateState('lastRecommendationsData', null);
    updateState('isContactPrompted', false);
    
    let currentContents = initialHistory.map(msg => ({ role: msg.role, parts: [{ text: msg.text }] }));
    currentContents.push({ role: 'user', parts: [{ text: "Run the recommendation engine based on the details provided." }] });

    try {
        let result = await handleApiCall(currentContents);
        let responseContent = result.candidates[0].content;

        if (responseContent.parts.some(p => p.functionCall)) {
            const toolCall = responseContent.parts.find(p => p.functionCall).functionCall;
            const toolResult = await executeToolCall(toolCall);
            
            currentContents.push({ role: 'model', parts: responseContent.parts });
            currentContents.push({ role: 'tool', parts: [{ functionResponse: { name: toolCall.name, response: toolResult.tool_output } }] });

            result = await handleApiCall(currentContents);
            responseContent = result.candidates[0].content;
            
            if(toolResult.tool_output.result.recommendations){
                 updateState('lastRecommendationsData', toolResult.tool_output.result.recommendations);
            }
        }
        
        const finalResponseText = responseContent.parts.find(p => p.text)?.text || "Here are your recommendations.";
        
        const initialMessage = initialHistory[0].text.split('**Generating')[0];
        updateState('chatHistory', []);
        displayResponse(`${initialMessage}\n\n${finalResponseText}`);
        
        setTimeout(() => {
            updateState('chatHistory', [...chatHistory, { role: 'model', text: "Do you have any other questions?" }]);
            updateState('isContactPrompted', true);
        }, 500);

    } catch (error) {
        console.error("Chatbot Error:", error);
        displayResponse("Sorry, a critical error occurred.");
    } finally {
        updateState('isLoading', false);
    }
}

async function handleSendMessage(userMessage) {
    if (!userMessage.trim() || isLoading) return;
    const chatInput = document.getElementById('chat-input');
    if (chatInput) chatInput.value = '';

    const newHistory = [...chatHistory, { role: 'user', text: userMessage }];
    updateState('chatHistory', newHistory);
    updateState('isLoading', true);

    try {
        const result = await handleApiCall(newHistory.map(m => ({ role: m.role, parts: [{text: m.text}] })));
        const responseText = result.candidates[0].content.parts[0].text;
        displayResponse(responseText);
    } catch (error) {
        console.error("Chatbot Send Error:", error);
        displayResponse("Sorry, I couldn't process that request.");
    } finally {
        updateState('isLoading', false);
    }
}

function handleHumanContactPrompt() {
    const { name, email, headcount, budgetAmount, budgetType, budgetFrequency, selectedSnackTypes, dietaryFilters } = userData;
    const budgetPresentation = budgetType === 'per_head' ? `$${budgetAmount} per head` : `$${budgetAmount} total`;
    const emailBody = `G'day Snack Proud Team,\n\nI just received a personalised recommendation from your AI Snack Agent...\n\nDetails:\n- Name: ${name}\n- Email: ${email}\n- Head Count: ${headcount}\n- Budget: ${budgetPresentation} / ${budgetFrequency}\n- Categories: ${selectedSnackTypes.join(', ')}\n- Filters: ${dietaryFilters.join(', ') || 'None'}\n\nCheers!`;
    const emailLink = `mailto:orders@snackproud.com.au?subject=Snack Agent Follow-up for ${name}&body=${encodeURIComponent(emailBody)}`;
    window.open(emailLink, '_blank');
}


// --- UI RENDERING & EVENT HANDLERS ---
function renderRecommendationCard(recommendation) {
    return `
        <div class="bg-white border border-gray-200 rounded-xl shadow-md overflow-hidden p-4 flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 transition duration-300 hover:shadow-lg">
            <img src="${recommendation.image_url}" alt="${recommendation.name}" class="w-full sm:w-20 h-20 object-cover rounded-lg flex-shrink-0" onerror="this.onerror=null;this.src='https://placehold.co/100x100/A9A9A9/ffffff?text=Snack'">
            <div class="flex-grow">
                <h3 class="text-lg font-bold" style="color: ${SP_COLORS.darkGreen};">${recommendation.name}</h3>
                <p class="text-sm text-gray-600">Unit Price: <strong class="text-gray-700">A$${recommendation.price.toFixed(2)}</strong></p>
                <p class="text-sm font-semibold mt-1" style="color: ${SP_COLORS.teal};">Quantity: <strong class="text-gray-900">${recommendation.quantity}</strong> | Total: <strong class="text-gray-900">A$${(recommendation.price * recommendation.quantity).toFixed(2)}</strong></p>
            </div>
            <a href="${recommendation.product_url}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg" style="background-color: ${SP_COLORS.yellow}; color: ${SP_COLORS.darkGreen};">View Product</a>
        </div>`;
}

function renderMessage(msg) {
    const roleClass = msg.role === 'user' ? 'justify-end' : 'justify-start';
    const bubbleStyle = `background-color: ${msg.role === 'user' ? SP_COLORS.teal : '#FFFFFF'}; color: ${msg.role === 'user' ? 'white' : SP_COLORS.textDark};`;
    const sender = msg.role === 'user' ? (userId ? `You (${userId.substring(0, 8)}...)` : 'You') : 'Snack Agent';
    const content = msg.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return `<div class="flex ${roleClass} mb-4"><div class="max-w-[85%] p-3 rounded-xl shadow-md" style="${bubbleStyle}"><p class="font-semibold text-xs mb-1 opacity-70">${sender}</p><div>${content}</div></div></div>`;
}

function renderCollapsibleCheckboxGroup(title, options, selected, type) {
    const listItems = options.map(item => `
        <div class="flex items-center">
            <input type="checkbox" id="check-${item.replace(/\s/g, '-')}-${type}" data-item="${item}" ${selected.includes(item) ? 'checked' : ''} class="h-4 w-4 rounded focus:ring-2" style="color: ${SP_COLORS.teal}; accent-color: ${SP_COLORS.teal};">
            <label for="check-${item.replace(/\s/g, '-')}-${type}" class="ml-2 block text-sm">${item}</label>
        </div>`).join('');
    return `
        <div class="mb-6 border rounded-lg shadow-sm">
            <button type="button" class="toggle-group w-full flex justify-between items-center p-3 font-semibold text-left rounded-t-lg" style="background-color: ${SP_COLORS.lightCream};" data-type="${type}">
                <span>${title} (${selected.length} selected)</span>
                <svg id="chevron-${type}" class="w-4 h-4 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            <div id="group-body-${type}" class="p-4 bg-white border-t hidden">
                <div class="flex justify-end mb-3">
                    <button type="button" class="toggle-all text-xs font-semibold px-2 py-1 rounded" style="color: ${SP_COLORS.teal}; background-color: ${SP_COLORS.lightCream};" data-type="${type}">${selected.length === options.length ? 'Deselect All' : 'Select All'}</button>
                </div>
                <div class="grid grid-cols-2 gap-3 checkbox-group" data-type="${type}">${listItems}</div>
            </div>
        </div>`;
}

function renderChatbotAgent() {
    const container = document.getElementById('snack-agent-container');
    if (!container) return;

    let contentHTML;
    if (!isFormSubmitted) {
        contentHTML = `
            <div class="bg-white rounded-2xl shadow-2xl p-8">
                <h2 class="text-2xl font-bold text-center mb-6" style="color:${SP_COLORS.darkGreen};">Snack Plan Creator</h2>
                <form id="pre-chat-form">
                    <div class="mb-4"><label class="block text-sm font-semibold mb-1">Your Name *</label><input type="text" name="name" value="${userData.name}" required class="w-full p-3 border rounded-lg"></div>
                    <div class="mb-4"><label class="block text-sm font-semibold mb-1">Email *</label><input type="email" name="email" value="${userData.email}" required class="w-full p-3 border rounded-lg"></div>
                    <div class="grid grid-cols-5 gap-3 mb-4 items-end">
                        <div class="col-span-3"><label class="block text-sm font-semibold mb-1">Budget (AUD) *</label><div class="relative"><div class="absolute inset-y-0 left-0 pl-3 flex items-center"><span>$</span></div><input type="number" name="budgetAmount" value="${userData.budgetAmount}" required min="0" step="0.01" class="w-full pl-7 p-3 border rounded-lg"></div></div>
                        <div class="col-span-2"><label class="block text-sm font-semibold mb-1">Calculation *</label><select name="budgetType" class="w-full p-3 border rounded-lg"><option value="total" ${userData.budgetType === 'total' ? 'selected' : ''}>Total</option><option value="per_head" ${userData.budgetType === 'per_head' ? 'selected' : ''}>Per Head</option></select></div>
                    </div>
                    <div class="grid grid-cols-5 gap-3 mb-4 items-end">
                        <div class="col-span-3"><label class="block text-sm font-semibold mb-1">Frequency</label><select name="budgetFrequency" class="w-full p-3 border rounded-lg"><option value="week" ${userData.budgetFrequency === 'week' ? 'selected' : ''}>Weekly</option><option value="fortnight" ${userData.budgetFrequency === 'fortnight' ? 'selected' : ''}>Fortnightly</option><option value="month" ${userData.budgetFrequency === 'month' ? 'selected' : ''}>Monthly</option></select></div>
                        <div class="col-span-2"><label class="block text-sm font-semibold mb-1">Head Count *</label><input type="number" name="headcount" value="${userData.headcount}" required min="1" class="w-full p-3 border rounded-lg"></div>
                    </div>
                    ${renderCollapsibleCheckboxGroup("Snack Categories", SNACK_TYPE_OPTIONS, userData.selectedSnackTypes, 'snack')}
                    ${renderCollapsibleCheckboxGroup("Dietary Needs", FILTER_OPTIONS, userData.dietaryFilters, 'filter')}
                    <button type="submit" class="w-full py-3 rounded-lg font-bold mt-4" style="background-color:${SP_COLORS.yellow}; color:${SP_COLORS.darkGreen};">${isLoading ? 'Processing...' : 'Start Personalised Chat'}</button>
                </form>
            </div>`;
    } else {
        contentHTML = `
            <div class="bg-white rounded-2xl shadow-2xl min-h-[700px] flex flex-col">
                <div class="p-3 border-b flex justify-between items-center"><h1 class="font-bold text-lg" style="color:${SP_COLORS.darkGreen};">Snack Agent for ${userData.name}</h1><button id="reset-chat-btn" class="text-sm px-3 py-1.5 rounded-full font-semibold" style="color:${SP_COLORS.teal}; border: 1px solid ${SP_COLORS.teal};">Reset</button></div>
                <div id="chat-body" class="flex-grow p-4 overflow-y-auto" style="max-height:560px">
                    ${chatHistory.map(renderMessage).join('')}
                    ${lastRecommendationsData ? `<div class="mt-4 space-y-3">${lastRecommendationsData.map(renderRecommendationCard).join('')}</div>` : ''}
                    ${isContactPrompted ? `<div class="text-center mt-4"><button id="human-contact-btn" class="px-6 py-2 rounded-full text-sm font-bold" style="background-color:${SP_COLORS.yellow}; color:${SP_COLORS.darkGreen};">Contact Human Team</button></div>` : ''}
                    ${isLoading ? `<div class="flex justify-start"><div class="p-3">...</div></div>` : ''}
                </div>
                <div class="p-4 border-t flex gap-3">
                    <input type="text" id="chat-input" class="flex-grow p-3 border rounded-lg" placeholder="Ask a follow-up..." ${isLoading ? 'disabled' : ''}>
                    <button id="send-message-btn" class="px-4 py-3 rounded-lg text-white font-semibold" style="background-color:${SP_COLORS.teal};" ${isLoading ? 'disabled' : ''}>Send</button>
                </div>
            </div>`;
    }
    container.innerHTML = contentHTML;
    attachEventListeners();
}

function handleFormSubmit() {
    const form = document.getElementById('pre-chat-form');
    userData.name = form.elements['name'].value;
    userData.email = form.elements['email'].value;
    userData.budgetAmount = form.elements['budgetAmount'].value;
    userData.budgetType = form.elements['budgetType'].value;
    userData.budgetFrequency = form.elements['budgetFrequency'].value;
    userData.headcount = form.elements['headcount'].value;
    
    if (!userData.name || !userData.email || !userData.budgetAmount || !userData.headcount) {
        return alert("Please fill out all required fields.");
    }
    updateState('isFormSubmitted', true);
    const initialGreeting = { role: 'model', text: `G'day, ${userData.name}! **Generating recommendations...**` };
    updateState('chatHistory', [initialGreeting]);
    handleRecommendationRun([initialGreeting]);
}

function handleCheckboxChange(item, type) {
    const key = type === 'snack' ? 'selectedSnackTypes' : 'dietaryFilters';
    let current = userData[key];
    if (current.includes(item)) {
        userData[key] = current.filter(i => i !== item);
    } else {
        userData[key].push(item);
    }
    renderChatbotAgent();
}

function handleToggleAll(type) {
    const key = type === 'snack' ? 'selectedSnackTypes' : 'dietaryFilters';
    const options = type === 'snack' ? SNACK_TYPE_OPTIONS : FILTER_OPTIONS;
    if (userData[key].length === options.length) {
        userData[key] = [];
    } else {
        userData[key] = [...options];
    }
    renderChatbotAgent();
}

function toggleCollapsibleGroup(type) {
    const body = document.getElementById(`group-body-${type}`);
    const chevron = document.getElementById(`chevron-${type}`);
    body.classList.toggle('hidden');
    chevron.classList.toggle('rotate-180');
}

function attachEventListeners() {
    const form = document.getElementById('pre-chat-form');
    if (form) form.addEventListener('submit', handleFormSubmit);

    document.querySelectorAll('.toggle-group').forEach(b => b.addEventListener('click', () => toggleCollapsibleGroup(b.dataset.type)));
    document.querySelectorAll('.toggle-all').forEach(b => b.addEventListener('click', () => handleToggleAll(b.dataset.type)));
    document.querySelectorAll('.checkbox-group').forEach(g => g.addEventListener('change', e => {
        if (e.target.type === 'checkbox') handleCheckboxChange(e.target.dataset.item, g.dataset.type);
    }));

    const sendBtn = document.getElementById('send-message-btn');
    if (sendBtn) {
        const chatInput = document.getElementById('chat-input');
        sendBtn.addEventListener('click', () => handleSendMessage(chatInput.value));
        chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSendMessage(chatInput.value); });
    }
    
    const resetBtn = document.getElementById('reset-chat-btn');
    if (resetBtn) resetBtn.addEventListener('click', () => location.reload());
    
    const humanBtn = document.getElementById('human-contact-btn');
    if(humanBtn) humanBtn.addEventListener('click', handleHumanContactPrompt);
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('current-year').textContent = new Date().getFullYear();
    renderChatbotAgent();
    
    const { initializeApp, getAuth, signInAnonymously, signInWithCustomToken } = window.firebase || {};
    if (!initializeApp) return console.warn("Firebase not available.");
    
    const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
    const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

    if (Object.keys(firebaseConfig).length > 0) {
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const authenticate = async () => {
            try {
                const cred = initialAuthToken ? await signInWithCustomToken(auth, initialAuthToken) : await signInAnonymously(auth);
                userId = cred.user.uid;
                console.log(`Authenticated as: ${userId}`);
            } catch (error) {
                console.error("Firebase Auth Error:", error);
                userId = 'fallback-' + Math.random().toString(36).substring(2);
            }
        };
        authenticate();
    } else {
        userId = 'fallback-' + Math.random().toString(36).substring(2);
    }
});

