/* Interactive Operations - Shadow Ads Lab Agency Website */

document.addEventListener("DOMContentLoaded", () => {
  
  // ==========================================
  // 1. MOBILE MENU TOGGLE
  // ==========================================
  const mobileToggle = document.getElementById("mobile-toggle");
  const navLinks = document.querySelector(".nav-links");

  if (mobileToggle && navLinks) {
    mobileToggle.addEventListener("click", () => {
      navLinks.classList.toggle("active");
      mobileToggle.classList.toggle("active");
    });

    // Close mobile menu when a link is clicked
    document.querySelectorAll(".nav-links a").forEach(link => {
      link.addEventListener("click", () => {
        navLinks.classList.remove("active");
        mobileToggle.classList.remove("active");
      });
    });
  }

  // ==========================================
  // 2. REVENUE COUNTER ANIMATION
  // ==========================================
  const revenueCounter = document.getElementById("revenue-counter");
  if (revenueCounter) {
    const startVal = 50000;
    const endVal = 100000;
    const duration = 2200; // 2.2 seconds
    let startTime = null;

    function formatCurrency(val) {
      return "$" + Math.floor(val).toLocaleString() + "+";
    }

    function animateCounter(currentTime) {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      
      // Ease out quad formula for smooth end
      const easeProgress = progress * (2 - progress);
      const currentVal = startVal + (endVal - startVal) * easeProgress;
      
      revenueCounter.textContent = formatCurrency(currentVal);

      if (progress < 1) {
        requestAnimationFrame(animateCounter);
      }
    }

    // Trigger after a short delay for transition feel
    setTimeout(() => {
      requestAnimationFrame(animateCounter);
    }, 400);
  }

  // ==========================================
  // 3. INTERACTIVE SCALE LOOP DIAGRAM
  // ==========================================
  const nodes = document.querySelectorAll(".loop-node");
  const explainerTitle = document.getElementById("explainer-node-title");
  const explainerDesc = document.getElementById("explainer-node-desc");
  let autoCycleInterval = null;
  let activeNodeIndex = 0;
  let userInteracted = false;

  const nodeInfo = {
    1: {
      title: "1. Scientific Media Buying",
      desc: "Our media buying team operates on rigorous account structures. No guess scaling. We allocate budgets horizontally and vertically based on 95% statistical confidence tests across Meta, Google, and TikTok."
    },
    2: {
      title: "2. Creative Testing Loop",
      desc: "We script, design, and deploy 10-15 new modular hook & body variants every single week. When creative fatigue starts, we already have pre-tested, winning ads waiting in the wings to maintain your ROAS."
    },
    3: {
      title: "3. Conversion Rate Optimization (CRO)",
      desc: "Traffic is expensive. We design, code, and launch custom speed-optimized landing pages built specifically around your active ad hooks, lifting standard conversion rates by 40% to 150%."
    },
    4: {
      title: "4. Retention Automation",
      desc: "Your customer list is a goldmine. We build and segment advanced Klaviyo flows (abandoned cart, VIP, win-back, post-purchase) to recover up to 30% of lost revenue on autopilot."
    },
    5: {
      title: "5. Weekly Data Feedback Loop",
      desc: "Every Friday, the scale data converges. Ad testing results dictate the next week's creative angles, funnel statistics dictate landing page adjustments, and retention rates adjust target acquisition margins."
    }
  };

  function activateNode(nodeId) {
    const infoKey = parseInt(nodeId);
    nodes.forEach(node => {
      node.classList.remove("active");
      if (node.getAttribute("data-node") === nodeId.toString()) {
        node.classList.add("active");
      }
    });

    // Update Explainer text with a smooth fade animation
    if (nodeInfo[infoKey]) {
      explainerTitle.style.opacity = 0;
      explainerDesc.style.opacity = 0;
      setTimeout(() => {
        explainerTitle.textContent = nodeInfo[infoKey].title;
        explainerDesc.textContent = nodeInfo[infoKey].desc;
        explainerTitle.style.opacity = 1;
        explainerDesc.style.opacity = 1;
      }, 150);
    }
  }

  // Start auto-cycling through loop nodes
  function startLoopCycle() {
    autoCycleInterval = setInterval(() => {
      if (!userInteracted) {
        activeNodeIndex = (activeNodeIndex + 1) % nodes.length;
        const nextNodeId = nodes[activeNodeIndex].getAttribute("data-node");
        activateNode(nextNodeId);
      }
    }, 4500); // cycle every 4.5 seconds
  }

  // Set up event listeners for loop nodes
  nodes.forEach(node => {
    node.addEventListener("click", () => {
      userInteracted = true;
      clearInterval(autoCycleInterval);
      const nodeId = node.getAttribute("data-node");
      activateNode(nodeId);
    });

    node.addEventListener("mouseover", () => {
      userInteracted = true;
      clearInterval(autoCycleInterval);
      const nodeId = node.getAttribute("data-node");
      activateNode(nodeId);
    });
  });

  // Initialize loop
  activateNode(1);
  startLoopCycle();

  // ==========================================
  // 4. PADLOCK SCROLL-UNLOCK TRIGGER
  // ==========================================
  const padlockSvg = document.getElementById("padlock-svg");
  const lockStatusText = document.getElementById("lock-status-text");

  if (padlockSvg && lockStatusText) {
    const lockObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Unlock the padlock
          padlockSvg.classList.add("unlocked");
          lockStatusText.textContent = "CONTRACT LOCK BROKEN";
          lockStatusText.classList.add("unlocked-badge");
        }
      });
    }, {
      threshold: 0.5 // trigger when 50% visible
    });

    lockObserver.observe(padlockSvg);
  }

  // ==========================================
  // 5. TIMELINE SCROLL HIGHLIGHT & FILL
  // ==========================================
  const timelineFill = document.getElementById("timeline-fill");
  const timelineSteps = document.querySelectorAll(".timeline-step");
  const timelineContainer = document.querySelector(".timeline-container");

  if (timelineSteps.length > 0 && timelineContainer) {
    
    // Set up step observer
    const stepObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("active");
        }
      });
    }, {
      rootMargin: "0px 0px -20% 0px", // Trigger when step is slightly above the bottom
      threshold: 0.25
    });

    timelineSteps.forEach(step => stepObserver.observe(step));

    // Dynamic line fill on scroll
    window.addEventListener("scroll", () => {
      const rect = timelineContainer.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      
      // Calculate how far down the timeline container the viewport center is
      const elementHeight = rect.height;
      const elementTopFromCenter = (viewportHeight / 2) - rect.top;
      
      let fillPercent = 0;
      if (elementTopFromCenter > 0) {
        fillPercent = Math.min((elementTopFromCenter / elementHeight) * 100, 100);
      }
      
      if (timelineFill) {
        timelineFill.style.height = `${fillPercent}%`;
      }
    });
  }

  // ==========================================
  // 6. SPOTS REMAINING URGENCY WIDGET
  // ==========================================
  const spotsCounter = document.getElementById("spots-counter");
  if (spotsCounter) {
    // Start at 3, maybe drop to 2 after a random delay for dynamic effect
    setTimeout(() => {
      spotsCounter.textContent = "2";
      spotsCounter.classList.add("text-orange");
    }, 15000); // 15 seconds after load
  }

  // ==========================================
  // 7. LEAD FORM SUBMISSION
  // ==========================================
  const leadForm = document.getElementById("growth-lead-form");
  const successModal = document.getElementById("success-modal");
  const closeModalBtn = document.getElementById("close-modal-btn");

  if (leadForm && successModal) {
    leadForm.addEventListener("submit", (e) => {
      e.preventDefault();
      
      // Gather data (simulation)
      const name = document.getElementById("full-name").value;
      const email = document.getElementById("email-address").value;
      const brand = document.getElementById("brand-name").value;
      const revenue = document.getElementById("current-rev").value;
      const url = document.getElementById("website-url").value;

      console.log("Lead captured:", { name, email, brand, revenue, url });

      // Trigger success state
      successModal.classList.add("active");
      leadForm.reset();
    });

    if (closeModalBtn) {
      closeModalBtn.addEventListener("click", () => {
        successModal.classList.remove("active");
      });
    }

    // Close modal on click outside
    successModal.addEventListener("click", (e) => {
      if (e.target === successModal) {
        successModal.classList.remove("active");
      }
    });
  }

});
