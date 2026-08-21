/**
 * Shop AI Chat - Client-side implementation
 *
 * This module handles the chat interface for the Shopify AI Chat application.
 * It manages the UI interactions, API communication, and message rendering.
 */
(function () {
  "use strict";

  // Shown when there is no stored conversation to restore. Overridden per shop
  // by the block's welcome_message setting. It asks for the city because that
  // is the assistant's first question anyway - answering it here saves a turn.
  const DEFAULT_WELCOME =
    "🎤 Hi! I can help you find a private karaoke room for your night out. Which city are you in?";

  /**
   * Application namespace to prevent global scope pollution
   */
  const ShopAIChat = {
    /**
     * UI-related elements and functionalityy
     */
    UI: {
      elements: {},
      isMobile: false,

      /**
       * Initialize UI elements and event listeners
       * @param {HTMLElement} container - The main container element
       */
      init: function (container) {
        if (!container) return;

        // Cache DOM elements
        this.elements = {
          container: container,
          chatBubble: container.querySelector(".shop-ai-chat-bubble"),
          chatWindow: container.querySelector(".shop-ai-chat-window"),
          closeButton: container.querySelector(".shop-ai-chat-close"),
          chatInput: container.querySelector(".shop-ai-chat-input input"),
          sendButton: container.querySelector(".shop-ai-chat-send"),
          messagesContainer: container.querySelector(".shop-ai-chat-messages"),
        };

        // Detect mobile device
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        // Set up event listeners
        this.setupEventListeners();

        // Fix for iOS Safari viewport height issues
        if (this.isMobile) {
          this.setupMobileViewport();
        }
      },

      /**
       * Set up all event listeners for UI interactions
       */
      setupEventListeners: function () {
        const {
          chatBubble,
          closeButton,
          chatInput,
          sendButton,
          messagesContainer,
        } = this.elements;

        // Toggle chat window visibility
        chatBubble.addEventListener("click", () => this.toggleChatWindow());

        // Close chat window
        closeButton.addEventListener("click", () => this.closeChatWindow());

        // Send message when pressing Enter in input
        chatInput.addEventListener("keypress", (e) => {
          if (e.key === "Enter" && chatInput.value.trim() !== "") {
            // send() cancels any stream in flight before starting the new one.
            ShopAIChat.Message.send(chatInput, messagesContainer);

            // On mobile, handle keyboard
            if (this.isMobile) {
              chatInput.blur();
              setTimeout(() => chatInput.focus(), 300);
            }
          }
        });

        // While streaming the button stops the stream; otherwise it sends.
        sendButton.addEventListener("click", () => {
          if (ShopAIChat.Message.isStreaming()) {
            ShopAIChat.Message.cancel();
            chatInput.focus();
            return;
          }

          if (chatInput.value.trim() !== "") {
            ShopAIChat.Message.send(chatInput, messagesContainer);

            // On mobile, focus input after sending
            if (this.isMobile) {
              setTimeout(() => chatInput.focus(), 300);
            }
          }
        });

        // Handle window resize to adjust scrolling
        window.addEventListener("resize", () => this.scrollToBottom());

        // Add global click handler for auth links
        document.addEventListener("click", function (event) {
          if (
            event.target &&
            event.target.classList.contains("shop-auth-trigger")
          ) {
            event.preventDefault();
            if (window.shopAuthUrl) {
              ShopAIChat.Auth.openAuthPopup(window.shopAuthUrl);
            }
          }
        });
      },

      /**
       * Setup mobile-specific viewport adjustments
       */
      setupMobileViewport: function () {
        const setViewportHeight = () => {
          document.documentElement.style.setProperty(
            "--viewport-height",
            `${window.innerHeight}px`,
          );
        };
        window.addEventListener("resize", setViewportHeight);
        setViewportHeight();
      },

      /**
       * Toggle chat window visibility
       */
      toggleChatWindow: function () {
        const { chatWindow, chatInput } = this.elements;

        chatWindow.classList.toggle("active");

        if (chatWindow.classList.contains("active")) {
          // On mobile, prevent body scrolling and delay focus
          if (this.isMobile) {
            document.body.classList.add("shop-ai-chat-open");
            setTimeout(() => chatInput.focus(), 500);
          } else {
            chatInput.focus();
          }
          // Always scroll messages to bottom when opening
          this.scrollToBottom();
        } else {
          // Remove body class when closing
          document.body.classList.remove("shop-ai-chat-open");
        }
      },

      /**
       * Close chat window
       */
      closeChatWindow: function () {
        const { chatWindow, chatInput } = this.elements;

        chatWindow.classList.remove("active");

        // On mobile, blur input to hide keyboard and enable body scrolling
        if (this.isMobile) {
          chatInput.blur();
          document.body.classList.remove("shop-ai-chat-open");
        }
      },

      /**
       * Scroll messages container to bottom
       */
      scrollToBottom: function () {
        const { messagesContainer } = this.elements;
        setTimeout(() => {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
      },

      /**
       * Show typing indicator in the chat
       */
      showTypingIndicator: function () {
        const { messagesContainer } = this.elements;

        const typingIndicator = document.createElement("div");
        typingIndicator.classList.add("shop-ai-typing-indicator");
        typingIndicator.innerHTML = "<span></span><span></span><span></span>";
        messagesContainer.appendChild(typingIndicator);
        this.scrollToBottom();
      },

      /**
       * Switch the send button between "send" and "stop streaming" modes.
       * @param {boolean} streaming - Whether a response is currently streaming
       */
      setSendButtonStreaming: function (streaming) {
        const { sendButton } = this.elements;
        if (!sendButton) return;

        sendButton.classList.toggle("is-streaming", streaming);
        sendButton.setAttribute(
          "aria-label",
          streaming ? "Stop generating" : "Send message",
        );
        sendButton.title = streaming ? "Stop generating" : "Send message";
      },

      /**
       * Remove typing indicator from the chat
       */
      removeTypingIndicator: function () {
        const { messagesContainer } = this.elements;

        const typingIndicator = messagesContainer.querySelector(
          ".shop-ai-typing-indicator",
        );
        if (typingIndicator) {
          typingIndicator.remove();
        }
      },

      /**
       * Display product results in the chat
       * @param {Array} products - Array of product data objects
       */
      displayProductResults: function (products) {
        const { messagesContainer } = this.elements;

        // Create a wrapper for the product section
        const productSection = document.createElement("div");
        productSection.classList.add("shop-ai-product-section");
        messagesContainer.appendChild(productSection);

        // Add a header for the product results
        const header = document.createElement("div");
        header.classList.add("shop-ai-product-header");
        header.innerHTML = "<h4>Top Matching Products</h4>";
        productSection.appendChild(header);

        // Create the product grid container
        const productsContainer = document.createElement("div");
        productsContainer.classList.add("shop-ai-product-grid");
        productSection.appendChild(productsContainer);

        if (!products || !Array.isArray(products) || products.length === 0) {
          const noProductsMessage = document.createElement("p");
          noProductsMessage.textContent = "No products found";
          noProductsMessage.style.padding = "10px";
          productsContainer.appendChild(noProductsMessage);
        } else {
          products.forEach((product) => {
            const productCard = ShopAIChat.Product.createCard(product);
            productsContainer.appendChild(productCard);
          });
        }

        this.scrollToBottom();
      },
    },

    /**
     * Message handling and display functionality
     */
    Message: {
      /**
       * Send a message to the API
       * @param {HTMLInputElement} chatInput - The input element
       * @param {HTMLElement} messagesContainer - The messages container
       */
      // Controller for the stream currently in flight, or null when idle.
      _controller: null,

      /** True while a response is streaming. */
      isStreaming: function () {
        return this._controller !== null;
      },

      /**
       * Cancel the stream in flight, if any. Safe to call when idle.
       */
      cancel: function () {
        if (this._controller) {
          this._controller.abort();
          this._controller = null;
          ShopAIChat.UI.setSendButtonStreaming(false);
        }
      },

      /**
       * Send a message the user didn't type - a card button acting on their
       * behalf. Goes through send() so cancelling, the typing indicator and the
       * user bubble all behave exactly as if they had typed it.
       * @param {string} text - The message to send
       */
      sendText: function (text) {
        if (!text) return;
        const { chatInput, messagesContainer } = ShopAIChat.UI.elements;
        if (!chatInput || !messagesContainer) return;
        chatInput.value = text;
        this.send(chatInput, messagesContainer);
      },

      send: async function (chatInput, messagesContainer) {
        const userMessage = chatInput.value.trim();
        if (!userMessage) return; // guard empty

        // A new message always supersedes the one still streaming.
        this.cancel();

        const conversationId = sessionStorage.getItem("shopAiConversationId");

        this.add(userMessage, "user", messagesContainer);
        chatInput.value = "";
        ShopAIChat.UI.showTypingIndicator();

        const controller = new AbortController();
        this._controller = controller;
        ShopAIChat.UI.setSendButtonStreaming(true);

        try {
          await ShopAIChat.API.streamResponse(
            // <- await, so errors land here
            userMessage,
            conversationId,
            messagesContainer,
            controller.signal,
          );
        } catch (error) {
          if (controller.signal.aborted) return; // user cancelled: nothing to report
          console.error("Error communicating with the agent:", error);
          ShopAIChat.UI.removeTypingIndicator();
          this.add(
            "Sorry, I couldn't process your request at the moment. Please try again later.",
            "assistant",
            messagesContainer,
          );
        } finally {
          // Only tear down if a newer send hasn't already taken over.
          if (this._controller === controller) {
            this._controller = null;
            ShopAIChat.UI.setSendButtonStreaming(false);
            chatInput.focus();
          }
        }
      },

      // send: async function (chatInput, messagesContainer) {
      //   const userMessage = chatInput.value.trim();
      //   const conversationId = sessionStorage.getItem("shopAiConversationId");

      //   // Add user message to chat
      //   this.add(userMessage, "user", messagesContainer);

      //   // Clear input
      //   chatInput.value = "";

      //   // Show typing indicator
      //   ShopAIChat.UI.showTypingIndicator();

      //   try {
      //     ShopAIChat.API.streamResponse(
      //       userMessage,
      //       conversationId,
      //       messagesContainer,
      //     );
      //   } catch (error) {
      //     console.error("Error communicating with Gemini API:", error);
      //     ShopAIChat.UI.removeTypingIndicator();
      //     this.add(
      //       "Sorry, I couldn't process your request at the moment. Please try again later.",
      //       "assistant",
      //       messagesContainer,
      //     );
      //   }
      // },

      /**
       * Add a message to the chat
       * @param {string} text - Message content
       * @param {string} sender - Message sender ('user' or 'assistant')
       * @param {HTMLElement} messagesContainer - The messages container
       * @returns {HTMLElement} The created message element
       */
      add: function (text, sender, messagesContainer) {
        const messageElement = document.createElement("div");
        messageElement.classList.add("shop-ai-message", sender);

        if (sender === "assistant") {
          messageElement.dataset.rawText = text;
          ShopAIChat.Formatting.formatMessageContent(messageElement);
        } else {
          messageElement.textContent = text;
        }

        messagesContainer.appendChild(messageElement);
        ShopAIChat.UI.scrollToBottom();

        return messageElement;
      },

      /**
       * Add a tool use message to the chat with expandable arguments
       * @param {string} toolMessage - Tool use message content
       * @param {HTMLElement} messagesContainer - The messages container
       */
      addToolUse: function (toolMessage, messagesContainer) {
        // Parse the tool message to extract tool name and arguments
        const match = toolMessage.match(
          /Calling tool: (\w+) with arguments: (.+)/,
        );
        if (!match) {
          // Fallback for unexpected format
          const toolUseElement = document.createElement("div");
          toolUseElement.classList.add("shop-ai-message", "tool-use");
          toolUseElement.textContent = toolMessage;
          messagesContainer.appendChild(toolUseElement);
          ShopAIChat.UI.scrollToBottom();
          return;
        }

        const toolName = match[1];
        const argsString = match[2];

        // Create the main tool use element
        const toolUseElement = document.createElement("div");
        toolUseElement.classList.add("shop-ai-message", "tool-use");

        // Create the header (always visible)
        const headerElement = document.createElement("div");
        headerElement.classList.add("shop-ai-tool-header");

        const toolText = document.createElement("span");
        toolText.classList.add("shop-ai-tool-text");
        toolText.textContent = `Calling tool: ${toolName}`;

        const toggleElement = document.createElement("span");
        toggleElement.classList.add("shop-ai-tool-toggle");
        toggleElement.textContent = "[+]";

        headerElement.appendChild(toolText);
        headerElement.appendChild(toggleElement);

        // Create the arguments section (initially hidden)
        const argsElement = document.createElement("div");
        argsElement.classList.add("shop-ai-tool-args");

        try {
          // Try to format JSON arguments nicely
          const parsedArgs = JSON.parse(argsString);
          argsElement.textContent = JSON.stringify(parsedArgs, null, 2);
        } catch (e) {
          // If not valid JSON, just show as-is
          argsElement.textContent = argsString;
        }

        // Add click handler to toggle arguments visibility
        headerElement.addEventListener("click", function () {
          const isExpanded = argsElement.classList.contains("expanded");
          if (isExpanded) {
            argsElement.classList.remove("expanded");
            toggleElement.textContent = "[+]";
          } else {
            argsElement.classList.add("expanded");
            toggleElement.textContent = "[-]";
          }
        });

        // Assemble the complete element
        toolUseElement.appendChild(headerElement);
        toolUseElement.appendChild(argsElement);

        messagesContainer.appendChild(toolUseElement);
        ShopAIChat.UI.scrollToBottom();
      },
    },

    /**
     * Text formatting and markdown handling
     */
    Formatting: {
      /**
       * Format message content with markdown and links
       * @param {HTMLElement} element - The element to format
       */
      formatMessageContent: function (element) {
        if (!element || !element.dataset.rawText) return;

        const rawText = element.dataset.rawText;

        // Process the text with various Markdown features
        let processedText = rawText;

        // Process Markdown links
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        processedText = processedText.replace(
          markdownLinkRegex,
          (match, text, url) => {
            // Check if it's an auth URL
            if (
              url.includes("shopify.com/authentication") &&
              (url.includes("oauth/authorize") ||
                url.includes("authentication"))
            ) {
              // Store the auth URL in a global variable for later use - this avoids issues with onclick handlers
              window.shopAuthUrl = url;
              // Just return normal link that will be handled by the document click handler
              return (
                '<a href="#auth" class="shop-auth-trigger">' + text + "</a>"
              );
            }
            // If it's a checkout link, replace the text
            else if (url.includes("/cart") || url.includes("checkout")) {
              return (
                '<a href="' +
                url +
                '" target="_blank" rel="noopener noreferrer">click here to proceed to checkout</a>'
              );
            } else {
              // For normal links, preserve the original text
              return (
                '<a href="' +
                url +
                '" target="_blank" rel="noopener noreferrer">' +
                text +
                "</a>"
              );
            }
          },
        );

        // Convert text to HTML with proper list handling
        processedText = this.convertMarkdownToHtml(processedText);

        // Apply the formatted HTML
        element.innerHTML = processedText;
      },

      /**
       * Convert Markdown text to HTML with list support
       * @param {string} text - Markdown text to convert
       * @returns {string} HTML content
       */
      convertMarkdownToHtml: function (text) {
        text = text.replace(/(\*\*|__)(.*?)\1/g, "<strong>$2</strong>");
        const lines = text.split("\n");
        let currentList = null;
        let listItems = [];
        let htmlContent = "";
        let startNumber = 1;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const unorderedMatch = line.match(/^\s*([-*])\s+(.*)/);
          const orderedMatch = line.match(/^\s*(\d+)[\.)]\s+(.*)/);

          if (unorderedMatch) {
            if (currentList !== "ul") {
              if (currentList === "ol") {
                htmlContent +=
                  `<ol start="${startNumber}">` + listItems.join("") + "</ol>";
                listItems = [];
              }
              currentList = "ul";
            }
            listItems.push("<li>" + unorderedMatch[2] + "</li>");
          } else if (orderedMatch) {
            if (currentList !== "ol") {
              if (currentList === "ul") {
                htmlContent += "<ul>" + listItems.join("") + "</ul>";
                listItems = [];
              }
              currentList = "ol";
              startNumber = parseInt(orderedMatch[1], 10);
            }
            listItems.push("<li>" + orderedMatch[2] + "</li>");
          } else {
            if (currentList) {
              htmlContent +=
                currentList === "ul"
                  ? "<ul>" + listItems.join("") + "</ul>"
                  : `<ol start="${startNumber}">` +
                    listItems.join("") +
                    "</ol>";
              listItems = [];
              currentList = null;
            }

            if (line.trim() === "") {
              htmlContent += "<br>";
            } else {
              htmlContent += "<p>" + line + "</p>";
            }
          }
        }

        if (currentList) {
          htmlContent +=
            currentList === "ul"
              ? "<ul>" + listItems.join("") + "</ul>"
              : `<ol start="${startNumber}">` + listItems.join("") + "</ol>";
        }

        htmlContent = htmlContent.replace(/<\/p><p>/g, "</p>\n<p>");
        return htmlContent;
      },
    },

    /**
     * API communication and data handling
     */
    API: {
      /**
       * Stream a response from the API
       * @param {string} userMessage - User's message text
       * @param {string} conversationId - Conversation ID for context
       * @param {HTMLElement} messagesContainer - The messages container
       */
      streamResponse: async function (
        userMessage,
        conversationId,
        messagesContainer,
        signal,
      ) {
        // One mutable context instead of passing elements around by value.
        const ctx = {
          messagesContainer,
          messageElement: null, // created lazily, on the first delta
          statusElement: null, // transient "Searching venues…" line
          lastStatus: null,
          // Cards arrive while the model is still composing, so they are held
          // here and rendered on "done" - otherwise they'd sit above the reply
          // they belong to, and reflow the text as each one lands.
          cards: [],
        };

        try {
          const baseUrl =
            "https://harmony-adk-agent-962952534311.us-central1.run.app";
          const response = await fetch(`${baseUrl}/chat/stream`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify({
              message: userMessage,
              session_id: conversationId || undefined,
            }),
            signal,
          });

          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() || "";

            for (const frame of frames) {
              if (!frame.startsWith("data: ")) continue;
              try {
                this.handleStreamEvent(JSON.parse(frame.slice(6)), ctx);
              } catch (e) {
                console.error("Error parsing event data:", e, frame);
              }
            }
          }
        } catch (error) {
          // A cancel isn't a failure: keep whatever streamed in and stay quiet.
          if (signal && signal.aborted) {
            this.clearStatus(ctx);
            ShopAIChat.UI.removeTypingIndicator();
            if (ctx.messageElement) {
              ShopAIChat.Formatting.formatMessageContent(ctx.messageElement);
            }
            return;
          }

          console.error("Error in streaming:", error);
          this.clearStatus(ctx);
          ShopAIChat.UI.removeTypingIndicator();
          ShopAIChat.Message.add(
            "Sorry, I couldn't process your request. Please try again later.",
            "assistant",
            messagesContainer,
          );
        }
      },

      /** Remove the transient status line, if one is showing. */
      clearStatus: function (ctx) {
        if (ctx.statusElement) {
          ctx.statusElement.remove();
          ctx.statusElement = null;
          ctx.lastStatus = null;
        }
      },

      // streamResponse: async function(userMessage, conversationId, messagesContainer) {
      //   let currentMessageElement = null;

      //   try {
      //     const promptType = window.shopChatConfig?.promptType || "standardAssistant";
      //     const requestBody = JSON.stringify({
      //       message: userMessage,
      //       conversation_id: conversationId,
      //       prompt_type: promptType
      //     });

      //     const streamUrl = 'https://harmony-assistant-962952534311.us-central1.run.app/chat';
      //     const shopId = window.shopId;

      //     const response = await fetch(streamUrl, {
      //       method: 'POST',
      //       headers: {
      //         'Content-Type': 'application/json',
      //         'Accept': 'text/event-stream',
      //         'X-Shopify-Shop-Id': shopId
      //       },
      //       body: requestBody
      //     });

      //     const reader = response.body.getReader();
      //     const decoder = new TextDecoder();
      //     let buffer = '';

      //     // Create initial message element
      //     let messageElement = document.createElement('div');
      //     messageElement.classList.add('shop-ai-message', 'assistant');
      //     messageElement.textContent = '';
      //     messageElement.dataset.rawText = '';
      //     messagesContainer.appendChild(messageElement);
      //     currentMessageElement = messageElement;

      //     // Process the stream
      //     while (true) {
      //       const { value, done } = await reader.read();
      //       if (done) break;

      //       buffer += decoder.decode(value, { stream: true });
      //       const lines = buffer.split('\n\n');
      //       buffer = lines.pop() || '';

      //       for (const line of lines) {
      //         if (line.startsWith('data: ')) {
      //           try {
      //             const data = JSON.parse(line.slice(6));
      //             this.handleStreamEvent(data, currentMessageElement, messagesContainer, userMessage,
      //               (newElement) => { currentMessageElement = newElement; });
      //           } catch (e) {
      //             console.error('Error parsing event data:', e, line);
      //           }
      //         }
      //       }
      //     }
      //   } catch (error) {
      //     console.error('Error in streaming:', error);
      //     ShopAIChat.UI.removeTypingIndicator();
      //     ShopAIChat.Message.add("Sorry, I couldn't process your request. Please try again later.",
      //       'assistant', messagesContainer);
      //   }
      // },

      /**
       * Handle stream events from the API
       * @param {Object} data - Event data
       * @param {HTMLElement} currentMessageElement - Current message element being updated
       * @param {HTMLElement} messagesContainer - The messages container
       * @param {string} userMessage - The original user message
       * @param {Function} updateCurrentElement - Callback to update the current element reference
       */
      handleStreamEvent: function (data, ctx) {
        switch (data.type) {
          case "session":
            if (data.session_id) {
              sessionStorage.setItem("shopAiConversationId", data.session_id);
            }
            break;

          case "tool": {
            const label = this.toolLabel(data.name);
            if (label === ctx.lastStatus) break; // same tool twice in a row: no flicker
            ctx.lastStatus = label;

            // Reuse the single status element instead of stacking bubbles.
            if (!ctx.statusElement) {
              ctx.statusElement = document.createElement("div");
              ctx.statusElement.classList.add("shop-ai-status");
              ctx.messagesContainer.appendChild(ctx.statusElement);
            }
            ctx.statusElement.textContent = label;
            ShopAIChat.UI.scrollToBottom();
            break;
          }

          case "delta":
            // First text of the turn: drop the status line, then create the bubble
            // so it always lands BELOW the status that preceded it.
            this.clearStatus(ctx);
            ShopAIChat.UI.removeTypingIndicator();

            if (!ctx.messageElement) {
              ctx.messageElement = document.createElement("div");
              ctx.messageElement.classList.add("shop-ai-message", "assistant");
              ctx.messageElement.dataset.rawText = "";
              ctx.messagesContainer.appendChild(ctx.messageElement);
            }
            ctx.messageElement.dataset.rawText += data.text;
            ctx.messageElement.textContent = ctx.messageElement.dataset.rawText;
            ShopAIChat.UI.scrollToBottom();
            break;

          case "card":
            // Held until "done" so it renders below the reply, not above it.
            if (data.card) ctx.cards.push(data.card);
            break;

          case "error":
            console.error("Stream error:", data.message);
            this.clearStatus(ctx);
            ShopAIChat.UI.removeTypingIndicator();
            ShopAIChat.Message.add(
              data.message,
              "assistant",
              ctx.messagesContainer,
            );
            break;

          case "done":
            this.clearStatus(ctx);
            ShopAIChat.UI.removeTypingIndicator();
            if (ctx.messageElement) {
              ShopAIChat.Formatting.formatMessageContent(ctx.messageElement);
            }
            ShopAIChat.Card.renderAll(ctx.cards, ctx.messagesContainer);
            ctx.cards = [];
            ShopAIChat.UI.scrollToBottom();
            break;
        }
      },

      // Our backend sends the raw function name; turn it into something readable.
      toolLabel: function (name) {
        const labels = {
          search_venues: "Searching venues…",
          get_venue_detail: "Getting venue details…",
          get_venue_rooms: "Looking up rooms…",
          get_room_detail: "Getting room details…",
          get_room_availability: "Checking availability…",
          create_booking_quote: "Preparing your quote…",
          checkout_from_quote: "Creating your checkout…",
          access_booking_by_token: "Opening your booking…",
          cancel_booking_by_token: "Cancelling your booking…",
          reschedule_booking_by_token: "Rescheduling your booking…",
        };
        return labels[name] || "Working…";
      },

      // handleStreamEvent: function(data, currentMessageElement, messagesContainer, userMessage, updateCurrentElement) {
      //   switch (data.type) {
      //     case 'id':
      //       if (data.conversation_id) {
      //         sessionStorage.setItem('shopAiConversationId', data.conversation_id);
      //       }
      //       break;

      //     case 'chunk':
      //       ShopAIChat.UI.removeTypingIndicator();
      //       currentMessageElement.dataset.rawText += data.chunk;
      //       currentMessageElement.textContent = currentMessageElement.dataset.rawText;
      //       ShopAIChat.UI.scrollToBottom();
      //       break;

      //     case 'message_complete':
      //       ShopAIChat.UI.removeTypingIndicator();
      //       ShopAIChat.Formatting.formatMessageContent(currentMessageElement);
      //       ShopAIChat.UI.scrollToBottom();
      //       break;

      //     case 'end_turn':
      //       ShopAIChat.UI.removeTypingIndicator();
      //       break;

      //     case 'error':
      //       console.error('Stream error:', data.error);
      //       ShopAIChat.UI.removeTypingIndicator();
      //       currentMessageElement.textContent = "Sorry, I couldn't process your request. Please try again later.";
      //       break;

      //     case 'rate_limit_exceeded':
      //       console.error('Rate limit exceeded:', data.error);
      //       ShopAIChat.UI.removeTypingIndicator();
      //       currentMessageElement.textContent = "Sorry, our servers are currently busy. Please try again later.";
      //       break;

      //     case 'auth_required':
      //       // Save the last user message for resuming after authentication
      //       sessionStorage.setItem('shopAiLastMessage', userMessage || '');
      //       break;

      //     case 'product_results':
      //       ShopAIChat.UI.displayProductResults(data.products);
      //       break;

      //     case 'tool_use':
      //       if (data.tool_use_message) {
      //         ShopAIChat.Message.addToolUse(data.tool_use_message, messagesContainer);
      //       }
      //       break;

      //     case 'new_message':
      //       ShopAIChat.Formatting.formatMessageContent(currentMessageElement);
      //       ShopAIChat.UI.showTypingIndicator();

      //       // Create new message element for the next response
      //       const newMessageElement = document.createElement('div');
      //       newMessageElement.classList.add('shop-ai-message', 'assistant');
      //       newMessageElement.textContent = '';
      //       newMessageElement.dataset.rawText = '';
      //       messagesContainer.appendChild(newMessageElement);

      //       // Update the current element reference
      //       updateCurrentElement(newMessageElement);
      //       break;

      //     case 'content_block_complete':
      //       ShopAIChat.UI.showTypingIndicator();
      //       break;
      //   }
      // },

      /**
       * Fetch chat history from the server
       * @param {string} conversationId - Conversation ID
       * @param {HTMLElement} messagesContainer - The messages container
       */
      fetchChatHistory: async function (conversationId, messagesContainer) {
        const welcomeMessage =
          window.shopChatConfig?.welcomeMessage || DEFAULT_WELCOME;

        // Declared outside the try so the catch can remove exactly this element
        // rather than guessing with a querySelector.
        const loadingMessage = document.createElement("div");
        loadingMessage.classList.add("shop-ai-message", "assistant");
        loadingMessage.textContent = "Loading conversation history...";
        messagesContainer.appendChild(loadingMessage);

        try {
          const baseUrl = "https://harmony-adk-agent-962952534311.us-central1.run.app";
          const historyUrl = `${baseUrl}/chat/${encodeURIComponent(conversationId)}/messages`;

          const response = await fetch(historyUrl, {
            method: "GET",
            headers: { Accept: "application/json" }, // no Content-Type on a GET
          });

          loadingMessage.remove();

          // 404 = unknown session. Expected after a server restart, since sessions
          // are held in memory. Not an error — just start a fresh conversation.
          if (response.status === 404) {
            sessionStorage.removeItem("shopAiConversationId");
            ShopAIChat.Message.add(
              welcomeMessage,
              "assistant",
              messagesContainer,
            );
            return;
          }

          if (!response.ok)
            throw new Error(`History fetch failed: ${response.status}`);

          const data = await response.json();

          if (!data.messages || data.messages.length === 0) {
            ShopAIChat.Message.add(
              welcomeMessage,
              "assistant",
              messagesContainer,
            );
            return;
          }

          // Already filtered server-side: no tool calls, no raw JSON, roles are
          // exactly "user" / "assistant". Cards come back rebuilt, so a reload
          // restores the transcript as it was rendered live rather than
          // flattening it into paragraphs.
          data.messages.forEach((m) => {
            if (m.text) ShopAIChat.Message.add(m.text, m.role, messagesContainer);
            ShopAIChat.Card.renderAll(m.cards, messagesContainer);
          });

          ShopAIChat.UI.scrollToBottom();
        } catch (error) {
          console.error("Error fetching chat history:", error);
          loadingMessage.remove();
          ShopAIChat.Message.add(
            welcomeMessage,
            "assistant",
            messagesContainer,
          );
          // Keep the session id here — a network blip shouldn't discard a live
          // conversation. Only a 404 above means the session is genuinely gone.
        }
      },

      // fetchChatHistory: async function (conversationId, messagesContainer) {
      //   try {
      //     // Show a loading message
      //     const loadingMessage = document.createElement("div");
      //     loadingMessage.classList.add("shop-ai-message", "assistant");
      //     loadingMessage.textContent = "Loading conversation history...";
      //     messagesContainer.appendChild(loadingMessage);

      //     // Fetch history from the server
      //     const historyUrl = `https://harmony-assistant-962952534311.us-central1.run.app/chat?history=true&conversation_id=${encodeURIComponent(conversationId)}`;
      //     console.log("Fetching history from:", historyUrl);

      //     const response = await fetch(historyUrl, {
      //       method: "GET",
      //       headers: {
      //         Accept: "application/json",
      //         "Content-Type": "application/json",
      //       },
      //       mode: "cors",
      //     });

      //     if (!response.ok) {
      //       console.error(
      //         "History fetch failed:",
      //         response.status,
      //         response.statusText,
      //       );
      //       throw new Error("Failed to fetch chat history: " + response.status);
      //     }

      //     const data = await response.json();

      //     // Remove loading message
      //     messagesContainer.removeChild(loadingMessage);

      //     // No messages, show welcome message
      //     if (!data.messages || data.messages.length === 0) {
      //       const welcomeMessage =
      //         window.shopChatConfig?.welcomeMessage ||
      //         "👋 Hi there! How can I help you today?";
      //       ShopAIChat.Message.add(
      //         welcomeMessage,
      //         "assistant",
      //         messagesContainer,
      //       );
      //       return;
      //     }

      //     // Add messages to the UI - filter out tool results
      //     data.messages.forEach((message) => {
      //       try {
      //         const messageContents = JSON.parse(message.content);
      //         for (const contentBlock of messageContents) {
      //           if (contentBlock.type === "text") {
      //             ShopAIChat.Message.add(
      //               contentBlock.text,
      //               message.role,
      //               messagesContainer,
      //             );
      //           }
      //         }
      //       } catch (e) {
      //         ShopAIChat.Message.add(
      //           message.content,
      //           message.role,
      //           messagesContainer,
      //         );
      //       }
      //     });

      //     // Scroll to bottom
      //     ShopAIChat.UI.scrollToBottom();
      //   } catch (error) {
      //     console.error("Error fetching chat history:", error);

      //     // Remove loading message if it exists
      //     const loadingMessage = messagesContainer.querySelector(
      //       ".shop-ai-message.assistant",
      //     );
      //     if (
      //       loadingMessage &&
      //       loadingMessage.textContent === "Loading conversation history..."
      //     ) {
      //       messagesContainer.removeChild(loadingMessage);
      //     }

      //     // Show error and welcome message
      //     const welcomeMessage =
      //       window.shopChatConfig?.welcomeMessage ||
      //       "👋 Hi there! How can I help you today?";
      //     ShopAIChat.Message.add(
      //       welcomeMessage,
      //       "assistant",
      //       messagesContainer,
      //     );

      //     // Clear the conversation ID since we couldn't fetch this conversation
      //     sessionStorage.removeItem("shopAiConversationId");
      //   }
      // },
    },

    /**
     * Authentication-related functionality
     */
    Auth: {
      /**
       * Opens an authentication popup window
       * @param {string|HTMLElement} authUrlOrElement - The auth URL or link element that was clicked
       */
      openAuthPopup: function (authUrlOrElement) {
        let authUrl;
        if (typeof authUrlOrElement === "string") {
          // If a string URL was passed directly
          authUrl = authUrlOrElement;
        } else {
          // If an element was passed
          authUrl = authUrlOrElement.getAttribute("data-auth-url");
          if (!authUrl) {
            console.error("No auth URL found in element");
            return;
          }
        }

        // Open the popup window centered in the screen
        const width = 600;
        const height = 700;
        const left = (window.innerWidth - width) / 2 + window.screenX;
        const top = (window.innerHeight - height) / 2 + window.screenY;

        const popup = window.open(
          authUrl,
          "ShopifyAuth",
          `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
        );

        // Focus the popup window
        if (popup) {
          popup.focus();
        } else {
          // If popup was blocked, show a message
          alert(
            "Please allow popups for this site to authenticate with Shopify.",
          );
        }

        // Start polling for token availability
        const conversationId = sessionStorage.getItem("shopAiConversationId");
        if (conversationId) {
          const messagesContainer = document.querySelector(
            ".shop-ai-chat-messages",
          );

          // Add a message to indicate authentication is in progress
          ShopAIChat.Message.add(
            "Authentication in progress. Please complete the process in the popup window.",
            "assistant",
            messagesContainer,
          );

          this.startTokenPolling(conversationId, messagesContainer);
        }
      },

      /**
       * Start polling for token availability
       * @param {string} conversationId - Conversation ID
       * @param {HTMLElement} messagesContainer - The messages container
       */
      startTokenPolling: function (conversationId, messagesContainer) {
        if (!conversationId) return;

        console.log("Starting token polling for conversation:", conversationId);
        const pollingId = "polling_" + Date.now();
        sessionStorage.setItem("shopAiTokenPollingId", pollingId);

        let attemptCount = 0;
        const maxAttempts = 30;

        const poll = async () => {
          if (sessionStorage.getItem("shopAiTokenPollingId") !== pollingId) {
            console.log(
              "Another polling session has started, stopping this one",
            );
            return;
          }

          if (attemptCount >= maxAttempts) {
            console.log("Max polling attempts reached, stopping");
            return;
          }

          attemptCount++;

          try {
            const tokenUrl =
              "https://harmony-assistant-962952534311.us-central1.run.app/auth/token-status?conversation_id=" +
              encodeURIComponent(conversationId);
            const response = await fetch(tokenUrl);

            if (!response.ok) {
              throw new Error("Token status check failed: " + response.status);
            }

            const data = await response.json();

            if (data.status === "authorized") {
              console.log("Token available, resuming conversation");
              const message = sessionStorage.getItem("shopAiLastMessage");

              if (message) {
                sessionStorage.removeItem("shopAiLastMessage");
                setTimeout(() => {
                  ShopAIChat.Message.add(
                    "Authorization successful! I'm now continuing with your request.",
                    "assistant",
                    messagesContainer,
                  );
                  ShopAIChat.API.streamResponse(
                    message,
                    conversationId,
                    messagesContainer,
                  );
                  ShopAIChat.UI.showTypingIndicator();
                }, 500);
              }

              sessionStorage.removeItem("shopAiTokenPollingId");
              return;
            }

            console.log("Token not available yet, polling again in 10s");
            setTimeout(poll, 10000);
          } catch (error) {
            console.error("Error polling for token status:", error);
            setTimeout(poll, 10000);
          }
        };

        setTimeout(poll, 2000);
      },
    },

    /**
     * Product-related functionality
     */
    Product: {
      /**
       * Create a product card element
       * @param {Object} product - Product data
       * @returns {HTMLElement} Product card element
       */
      createCard: function (product) {
        const card = document.createElement("div");
        card.classList.add("shop-ai-product-card");

        // Create image container
        const imageContainer = document.createElement("div");
        imageContainer.classList.add("shop-ai-product-image");

        // Add product image or placeholder
        const image = document.createElement("img");
        image.src =
          product.image_url ||
          "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png";
        image.alt = product.title;
        image.onerror = function () {
          // If image fails to load, use a fallback placeholder
          this.src =
            "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png";
        };
        imageContainer.appendChild(image);
        card.appendChild(imageContainer);

        // Add product info
        const info = document.createElement("div");
        info.classList.add("shop-ai-product-info");

        // Add product title
        const title = document.createElement("h3");
        title.classList.add("shop-ai-product-title");
        title.textContent = product.title;

        // If product has a URL, make the title a link
        if (product.url) {
          const titleLink = document.createElement("a");
          titleLink.href = product.url;
          titleLink.target = "_blank";
          titleLink.textContent = product.title;
          title.textContent = "";
          title.appendChild(titleLink);
        }

        info.appendChild(title);

        // Add product price
        const price = document.createElement("p");
        price.classList.add("shop-ai-product-price");
        price.textContent = product.price;
        info.appendChild(price);

        // Add add-to-cart button
        const button = document.createElement("button");
        button.classList.add("shop-ai-add-to-cart");
        button.textContent = "Add to Cart";
        button.dataset.productId = product.id;

        // Add click handler for the button
        button.addEventListener("click", function () {
          ShopAIChat.Message.sendText(`Add ${product.title} to my cart`);
        });

        info.appendChild(button);
        card.appendChild(info);

        return card;
      },
    },

    /**
     * Rendering for the structured cards the agent returns alongside its reply
     * (venues, rooms, time slots, quotes, checkout, bookings).
     *
     * The server decides WHAT a card is and what you can do with it; everything
     * here is about how it looks. Card shapes are documented in cards.py.
     *
     * All server values go in via textContent, never innerHTML - they come from
     * the storefront API, so they are data, not markup.
     */
    Card: {
      /**
       * Render a list of cards into a container.
       * @param {Array} cards - Card objects from the API
       * @param {HTMLElement} messagesContainer - Where to append them
       */
      renderAll: function (cards, messagesContainer) {
        if (!Array.isArray(cards) || cards.length === 0) return;
        cards.forEach((card) => {
          const element = this.create(card);
          if (!element) return;

          // A new quote supersedes every earlier one. Without this, scrolling
          // up and confirming a stale quote stays possible until it expires -
          // and the agent would be handed the wrong quote id. Retire them
          // before appending, so the new card isn't caught by its own sweep.
          if (card.kind === "quote") {
            this.retire(messagesContainer, "quote", "Replaced by a newer quote.");
          }

          messagesContainer.appendChild(element);
        });
        ShopAIChat.UI.scrollToBottom();
      },

      /**
       * Spend every card of a kind still live in the transcript.
       * @param {HTMLElement} container
       * @param {string} kind - Card kind, e.g. "quote"
       * @param {string} reason - Shown in place of the countdown
       */
      retire: function (container, kind, reason) {
        container
          .querySelectorAll(`.shop-ai-card--${kind}:not(.is-spent)`)
          .forEach((element) => this.spend(element, reason));
      },

      /**
       * Build one card element.
       * @param {Object} card - Card object with kind/title/items/actions
       * @returns {HTMLElement|null}
       */
      create: function (card) {
        if (!card || !card.kind) return null;

        const element = document.createElement("div");
        element.classList.add("shop-ai-card", `shop-ai-card--${card.kind}`);
        element.dataset.kind = card.kind;

        if (card.title) {
          const title = document.createElement("div");
          title.classList.add("shop-ai-card-title");
          title.textContent = card.title;
          element.appendChild(title);
        }

        const items = card.items || [];
        if (items.length) {
          const list = document.createElement("div");
          // Slots and options are compact chips; everything else stacks.
          const compact = card.kind === "availability" || card.kind === "option_choice";
          list.classList.add(compact ? "shop-ai-card-chips" : "shop-ai-card-items");

          const renderItem = this.items[card.kind] || this.items.default;
          items.forEach((item) => {
            const itemElement = renderItem.call(this, item, card, element);
            if (!itemElement) return;
            // Actions are appended here rather than by each renderer, so they
            // always sit last - below the detail they act on, never above it.
            // Chips are themselves the button, so they are left alone.
            if (
              item.actions &&
              item.actions.length &&
              !itemElement.classList.contains("shop-ai-card-chip")
            ) {
              itemElement.appendChild(this.actionRow(item.actions, element));
            }
            list.appendChild(itemElement);
          });
          element.appendChild(list);
        } else if (card.kind === "availability") {
          // A real answer, not a blank card. Covers both a fully-booked day and
          // one the room isn't open at all, which we can't tell apart here.
          const empty = document.createElement("div");
          empty.classList.add("shop-ai-card-empty");
          empty.textContent = "No times available on this date.";
          element.appendChild(empty);
        }

        if (card.actions && card.actions.length) {
          element.appendChild(this.actionRow(card.actions, element));
        }

        // A quote is only held for a few minutes - show the clock running.
        if (card.expires_at) this.watchExpiry(element, card.expires_at);

        return element;
      },

      /**
       * Per-kind item renderers. Each returns the element for one item.
       */
      items: {
        default: function (item) {
          return this.itemCard(item, [item.subtitle, item.address]);
        },

        venue_list: function (item) {
          const element = this.itemCard(item, [
            item.subtitle,
            item.capacity,
            item.room_count ? `${item.room_count} rooms` : null,
            item.age_restricted ? "21+" : null,
          ]);
          // Where the venue actually is - the thing that decides whether
          // someone can get there. Same treatment as the detail card.
          element.appendChild(this.note(item.address));
          return element;
        },

        venue_detail: function (item) {
          const element = this.itemCard(item, [
            item.subtitle,
            item.capacity,
            item.room_count ? `${item.room_count} rooms` : null,
            item.age_minimum ? `${item.age_minimum}+` : null,
          ]);
          if (item.address) element.appendChild(this.note(item.address));
          if (item.terms) element.appendChild(this.disclosure("Terms", item.terms));
          return element;
        },

        room_list: function (item) {
          const element = this.itemCard(item, [item.capacity, item.price_display]);
          element.prepend(this.image(item.image_url, item.title));
          // In a list, the packages are a count - naming them all would bury
          // the rooms. The detail card below spells them out instead.
          const options = item.options || [];
          if (options.length) {
            element.appendChild(
              this.note(
                options.length === 1
                  ? "1 package available"
                  : `${options.length} packages available`,
              ),
            );
          }
          element.appendChild(this.note(this.policyLine(item.policies)));
          return element;
        },

        room_detail: function (item) {
          const element = this.itemCard(item, [item.capacity, item.price_display]);
          element.prepend(this.image(item.image_url, item.title));

          // Packages are a choice, not a description - render them as chips the
          // user can tap instead of bullets they would have to type back.
          const options = item.options || [];
          if (options.length) {
            element.appendChild(
              this.note(
                options.length === 1
                  ? "Includes a package:"
                  : "Choose a package:",
              ),
            );
            const chips = document.createElement("div");
            chips.classList.add("shop-ai-card-chips");
            options.forEach((option) => {
              const chip = this.chip(option.actions && option.actions[0]);
              if (chip) chips.appendChild(chip);
            });
            element.appendChild(chips);

            // A package price is the whole price. Without this the chip reads
            // like a surcharge on top of the room.
            element.appendChild(this.note(item.price_note));
          }

          element.appendChild(this.note(this.policyLine(item.policies)));
          return element;
        },

        availability: function (item) {
          return this.chip(item.actions && item.actions[0]);
        },

        option_choice: function (item) {
          return this.chip(item.actions && item.actions[0], true);
        },

        quote: function (item) {
          const element = document.createElement("div");
          element.classList.add("shop-ai-card-item");

          const where = [item.venue && item.venue.name, item.room && item.room.name]
            .filter(Boolean)
            .join(" - ");
          if (where) {
            const heading = document.createElement("h4");
            heading.classList.add("shop-ai-card-item-title");
            heading.textContent = where;
            element.appendChild(heading);
          }

          const when = [item.date, item.start_time_display || item.start_time]
            .filter(Boolean)
            .join(" at ");
          element.appendChild(this.row("When", when));
          element.appendChild(
            this.row(
              "Guests",
              item.guest_count == null ? null : String(item.guest_count),
            ),
          );
          element.appendChild(this.row("Package", item.option));
          element.appendChild(this.row("Total", item.total_display, "is-total"));
          element.appendChild(this.note(this.policyLine(item.policies)));
          return element;
        },

        checkout: function () {
          // The action row is the whole card; nothing to show above it.
          return null;
        },

        booking: function (item) {
          const element = document.createElement("div");
          element.classList.add("shop-ai-card-item");

          const where = [item.venue && item.venue.name, item.room && item.room.name]
            .filter(Boolean)
            .join(" - ");
          const heading = document.createElement("h4");
          heading.classList.add("shop-ai-card-item-title");
          heading.textContent = where || "Booking";
          if (item.status) {
            const badge = document.createElement("span");
            badge.classList.add(
              "shop-ai-card-badge",
              `is-${String(item.status).toLowerCase()}`,
            );
            badge.textContent = item.status;
            heading.appendChild(badge);
          }
          element.appendChild(heading);

          element.appendChild(
            this.row(
              "When",
              [item.date, item.start_time_display || item.start_time]
                .filter(Boolean)
                .join(" at "),
            ),
          );
          element.appendChild(
            this.row(
              "Guests",
              item.guest_count == null ? null : String(item.guest_count),
            ),
          );
          element.appendChild(this.row("Reference", item.reference));
          return element;
        },

        // A cancelled or rescheduled booking is the same card as a live one -
        // only the heading and the remaining actions differ, and the server
        // has already decided both.
        booking_cancelled: function (item) {
          return this.items.booking.call(this, item);
        },

        booking_rescheduled: function (item) {
          return this.items.booking.call(this, item);
        },
      },

      // --- building blocks ---------------------------------------------------

      /**
       * The common shape: a title, a line of short facts, then its actions.
       * @param {Object} item
       * @param {Array} facts - Short strings; blanks are dropped
       */
      itemCard: function (item, facts) {
        const element = document.createElement("div");
        element.classList.add("shop-ai-card-item");

        if (item.title) {
          const heading = document.createElement("h4");
          heading.classList.add("shop-ai-card-item-title");
          heading.textContent = item.title;
          element.appendChild(heading);
        }

        const present = (facts || []).filter(Boolean);
        if (present.length) {
          const meta = document.createElement("div");
          meta.classList.add("shop-ai-card-meta");
          present.forEach((fact) => {
            const span = document.createElement("span");
            span.textContent = fact;
            meta.appendChild(span);
          });
          element.appendChild(meta);
        }
        return element;
      },

      /** A single labelled fact; renders nothing when the value is missing. */
      row: function (label, value, modifier) {
        if (value === null || value === undefined || value === "") {
          return document.createDocumentFragment();
        }
        const row = document.createElement("div");
        row.classList.add("shop-ai-card-row");
        if (modifier) row.classList.add(modifier);

        const key = document.createElement("span");
        key.textContent = label;
        const val = document.createElement("span");
        val.textContent = value;

        row.appendChild(key);
        row.appendChild(val);
        return row;
      },

      /**
       * A room photo, or nothing at all. A missing image is common (the room
       * simply has none set), so it must leave no gap behind.
       */
      image: function (url, alt) {
        if (!url) return document.createDocumentFragment();
        const image = document.createElement("img");
        image.classList.add("shop-ai-card-image");
        image.src = url;
        image.alt = alt || "";
        image.loading = "lazy";
        // A broken CDN URL should collapse the tile, not leave a torn icon.
        image.addEventListener("error", () => image.remove());
        return image;
      },

      /** Secondary text under an item. */
      note: function (text) {
        if (!text) return document.createDocumentFragment();
        const note = document.createElement("div");
        note.classList.add("shop-ai-card-note");
        note.textContent = text;
        return note;
      },

      /** Collapsed long text (terms), so it never dominates the card. */
      disclosure: function (label, text) {
        const details = document.createElement("details");
        details.classList.add("shop-ai-card-disclosure");
        const summary = document.createElement("summary");
        summary.textContent = label;
        const body = document.createElement("p");
        body.textContent = text;
        details.appendChild(summary);
        details.appendChild(body);
        return details;
      },

      /** One-line summary of what the cancellation policy allows. */
      policyLine: function (policies) {
        if (!policies) return null;
        if (policies.cancellation_allowed === false) return "Non-refundable";
        if (policies.cancellation_allowed === true) {
          const hours = policies.cancellation_window_hours;
          return hours
            ? `Free cancellation up to ${hours}h before`
            : "Free cancellation";
        }
        return null;
      },

      /** A slot/option button that is the whole item. */
      chip: function (action, wide) {
        if (!action) return null;
        const button = this.button(action);
        button.classList.add("shop-ai-card-chip");
        if (wide) button.classList.add("is-wide");
        return button;
      },

      actionRow: function (actions, cardElement) {
        const row = document.createElement("div");
        row.classList.add("shop-ai-card-actions");
        actions.forEach((action) => row.appendChild(this.button(action, cardElement)));
        return row;
      },

      /**
       * Build one action button. `style` is semantic - the CSS decides how each
       * one looks.
       */
      button: function (action, cardElement) {
        const button = document.createElement("button");
        button.classList.add(
          "shop-ai-card-btn",
          `shop-ai-card-btn--${action.style || "secondary"}`,
        );
        button.textContent = action.label;
        if (action.once) button.dataset.once = "true";
        button.addEventListener("click", () =>
          this.run(action, button, cardElement),
        );
        return button;
      },

      /**
       * Perform an action. Most post a message to the agent on the user's
       * behalf; open_url and copy never touch the conversation.
       */
      run: function (action, button, cardElement) {
        if (button.disabled) return;

        if (action.action === "open_url") {
          window.open(action.url, "_blank", "noopener,noreferrer");
          return;
        }

        if (action.action === "copy") {
          const done = () => {
            const original = button.textContent;
            button.textContent = "Copied";
            setTimeout(() => {
              button.textContent = original;
            }, 1500);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(action.value).then(done, () => {});
          }
          return;
        }

        // Irreversible actions ask first (cancelling a booking).
        if (action.confirm && !window.confirm(action.confirm)) return;

        // Single-use actions are spent immediately, so a double tap can't
        // send the same booking twice.
        if (action.once && cardElement) this.spend(cardElement);

        ShopAIChat.Message.sendText(action.message);
      },

      /**
       * Disable the single-use actions in a card once one has been taken.
       * @param {HTMLElement} cardElement
       * @param {string} [reason] - Replaces the countdown line. Omit when the
       *   card explains itself (an expiry sets its own text, and a confirmed
       *   quote has nothing left to count down).
       */
      spend: function (cardElement, reason) {
        cardElement.classList.add("is-spent");
        cardElement
          .querySelectorAll(".shop-ai-card-btn[data-once]")
          .forEach((button) => {
            button.disabled = true;
          });

        // Stop the clock, or the next tick overwrites whatever we say here.
        if (cardElement._expiryTimer) {
          clearInterval(cardElement._expiryTimer);
          cardElement._expiryTimer = null;
        }

        const note = cardElement.querySelector(".shop-ai-card-expiry");
        if (!note) return;
        if (reason) {
          note.textContent = reason;
          note.classList.add("is-expired");
        } else if (!note.classList.contains("is-expired")) {
          // Confirmed, not expired: a frozen "Held for 2:04" would read as a
          // stuck clock, so drop the line entirely.
          note.remove();
        }
      },

      /**
       * Count a quote down to its expiry, then retire its actions - a stale
       * quote scrolled back to must not still look bookable.
       */
      watchExpiry: function (cardElement, expiresAt) {
        const deadline = Date.parse(expiresAt);
        if (Number.isNaN(deadline)) return;

        const note = document.createElement("div");
        note.classList.add("shop-ai-card-expiry");
        cardElement.appendChild(note);

        // The first tick runs before the card has been appended, so "not in the
        // document" only means "gone" once it has actually been mounted -
        // otherwise the countdown would stop before it ever started.
        let mounted = false;

        const tick = () => {
          if (document.contains(cardElement)) mounted = true;
          else if (mounted) return clearInterval(timer);

          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            clearInterval(timer);
            note.textContent = "This quote has expired.";
            note.classList.add("is-expired");
            this.spend(cardElement);
            return;
          }
          const minutes = Math.floor(remaining / 60000);
          const seconds = Math.floor((remaining % 60000) / 1000);
          note.textContent = `Held for ${minutes}:${String(seconds).padStart(2, "0")}`;
        };

        // Held on the element so spend() can stop it when the quote is
        // confirmed or superseded before it ever runs out.
        const timer = setInterval(tick, 1000);
        cardElement._expiryTimer = timer;
        tick();
      },
    },

    /**
     * Initialize the chat application
     */
    init: function () {
      // Initialize UI
      const container = document.querySelector(".shop-ai-chat-container");
      if (!container) return;

      this.UI.init(container);

      // Check for existing conversation
      const conversationId = sessionStorage.getItem("shopAiConversationId");

      if (conversationId) {
        // Fetch conversation history
        this.API.fetchChatHistory(
          conversationId,
          this.UI.elements.messagesContainer,
        );
      } else {
        // No previous conversation, show welcome message
        const welcomeMessage =
          window.shopChatConfig?.welcomeMessage || DEFAULT_WELCOME;
        this.Message.add(
          welcomeMessage,
          "assistant",
          this.UI.elements.messagesContainer,
        );
      }
    },
  };

  // Initialize the application when DOM is ready
  document.addEventListener("DOMContentLoaded", function () {
    ShopAIChat.init();
  });
})();
