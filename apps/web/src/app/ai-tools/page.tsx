"use client";

import { useEffect, useState } from "react";

// The fixed "AI Social Media Tools" landing page, served at /ai-tools.
// Bootstrap CSS comes from the global layout; Font Awesome via CDN link below.

export default function AiToolsPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // Smooth scroll for anchor links
    const anchors = document.querySelectorAll('a[href^="#"]');
    const onClick = (e: Event) => {
      e.preventDefault();
      const href = (e.currentTarget as HTMLAnchorElement).getAttribute("href");
      const target = href ? document.querySelector(href) : null;
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    anchors.forEach((a) => a.addEventListener("click", onClick));

    // Navbar background on scroll
    const onScroll = () => setScrolled(window.pageYOffset > 30);
    onScroll();
    window.addEventListener("scroll", onScroll);

    return () => {
      anchors.forEach((a) => a.removeEventListener("click", onClick));
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div className={`ai-tools ${scrolled ? "nav-scrolled" : ""}`}>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css" />

      <style>{`
        .ai-tools header {
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          color: #fff;
        }
        .ai-tools .nav-scrolled .navbar {
          box-shadow: 0 2px 12px rgba(0,0,0,.35);
        }
        .ai-tools .navbar {
          transition: box-shadow .2s ease;
        }
      `}</style>

      {/* Navigation */}
      <nav className="navbar navbar-expand-lg navbar-dark bg-dark sticky-top">
        <div className="container">
          <a className="navbar-brand" href="/ai-tools"><i className="fas fa-palette me-2"></i>AI Social Tools</a>
          <button
            className="navbar-toggler"
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="navbar-toggler-icon"></span>
          </button>
          <div className={`collapse navbar-collapse ${menuOpen ? "show" : ""}`} id="navbarNav">
            <ul className="navbar-nav ms-auto">
              <li className="nav-item"><a className="nav-link" href="#models">Models</a></li>
              <li className="nav-item"><a className="nav-link" href="#features">Features</a></li>
              <li className="nav-item"><a className="nav-link" href="#resources">Resources</a></li>
              <li className="nav-item"><a className="nav-link" href="#contact">Contact</a></li>
            </ul>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <header id="contact" className="py-5">
        <div className="container">
          <div className="row align-items-center">
            <div className="col-lg-6">
              <h1 className="display-4 fw-bold mb-3">Free AI Tools for<br />Social Media Success</h1>
              <p className="lead mb-4">Create stunning images, videos, and captions with the best free AI models. No sign-up required.</p>
              <a href="#models" className="btn btn-primary btn-lg">Explore Models</a>
            </div>
            <div className="col-lg-6">
              <div className="ratio ratio-16x9">
                <svg className="bg-light overflow-hidden" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
                  <image href="https://placehold.co/1200x675/1a1a2e/ffffff?text=AI+Social+Media" width="100%" height="100%" preserveAspectRatio="slice" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Models Section */}
      <section id="models" className="py-5">
        <div className="container">
          <div className="text-center mb-5">
            <h2>Top Free AI Models</h2>
            <p>Curated selection of the best free models for social media content creation</p>
          </div>
          <div className="row g-4">
            <div className="col-md-4">
              <div className="card h-100">
                <div className="card-body">
                  <h5 className="card-title"><i className="fas fa-image text-primary me-2"></i>Image Generation</h5>
                  <p className="card-text">Nano Banana Pro, Seedream - Text-to-image, 4K output, no watermark</p>
                  <a href="#" className="stretched-link">Learn More</a>
                </div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="card h-100">
                <div className="card-body">
                  <h5 className="card-title"><i className="fas fa-video text-success me-2"></i>Video Generation</h5>
                  <p className="card-text">Hailuo 2.3, Kling V3 - Text-to-video, 1080p, up to 10s, social-optimized</p>
                  <a href="#" className="stretched-link">Learn More</a>
                </div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="card h-100">
                <div className="card-body">
                  <h5 className="card-title"><i className="fas fa-pen-alt text-info me-2"></i>Caption &amp; Text</h5>
                  <p className="card-text">Qwen 2.5 7B, Nemotron - Captions, hashtags, copywriting, 6K tokens/day free</p>
                  <a href="#" className="stretched-link">Learn More</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-5 bg-light">
        <div className="container">
          <div className="row align-items-center">
            <div className="col-lg-6">
              <h2><i className="fas fa-star me-2"></i>Why Choose Free AI?</h2>
              <ul className="list-group list-group-flush">
                <li className="list-group-item"><i className="fas fa-check-circle text-primary me-2"></i>Completely free - no hidden costs</li>
                <li className="list-group-item"><i className="fas fa-check-circle text-primary me-2"></i>No sign-up or login required</li>
                <li className="list-group-item"><i className="fas fa-check-circle text-primary me-2"></i>Daily free quotas for regular use</li>
                <li className="list-group-item"><i className="fas fa-check-circle text-primary me-2"></i>Commercial use permitted on most models</li>
                <li className="list-group-item"><i className="fas fa-check-circle text-primary me-2"></i>Optimized for social media formats</li>
              </ul>
            </div>
            <div className="col-lg-6">
              <div className="row g-3">
                <div className="col-6">
                  <div className="card text-white bg-primary">
                    <div className="card-body">
                      <h5 className="card-title">Image Turbo</h5>
                      <p className="card-text">Fast text-to-image, great for concepts</p>
                    </div>
                  </div>
                </div>
                <div className="col-6">
                  <div className="card text-white bg-success">
                    <div className="card-body">
                      <h5 className="card-title">Seedance 2.0</h5>
                      <p className="card-text">Image-to-video, character scenes</p>
                    </div>
                  </div>
                </div>
                <div className="col-6">
                  <div className="card text-white bg-info">
                    <div className="card-body">
                      <h5 className="card-title">Hailuo 2.3</h5>
                      <p className="card-text">Text-to-video, fast iteration</p>
                    </div>
                  </div>
                </div>
                <div className="col-6">
                  <div className="card text-white bg-warning">
                    <div className="card-body">
                      <h5 className="card-title">Kling V3</h5>
                      <p className="card-text">Cinematic quality, 4K support</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Resources Section */}
      <section id="resources" className="py-5">
        <div className="container">
          <div className="text-center mb-5">
            <h2>Getting Started Resources</h2>
          </div>
          <div className="row g-4">
            <div className="col-md-6">
              <div className="card h-100">
                <div className="card-body">
                  <h5 className="card-title"><i className="fas fa-book-open me-2"></i>Beginner&apos;s Guide</h5>
                  <p className="card-text">How to get started with free AI generation, prompt tips, and best practices for social media.</p>
                  <a href="#" className="btn btn-link stretched-link">Read Guide</a>
                </div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="card h-100">
                <div className="card-body">
                  <h5 className="card-title"><i className="fas fa-terminal me-2"></i>API Integration</h5>
                  <p className="card-text">How to integrate these models into your own tools using OpenRouter, OpenCode, or direct APIs.</p>
                  <a href="#" className="btn btn-link stretched-link">View Docs</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-5 bg-primary text-white">
        <div className="container">
          <div className="row align-items-center">
            <div className="col-lg-8">
              <h3>Ready to create amazing social media content?</h3>
              <p>Start generating free AI images and videos in seconds. No credit card, no sign-up.</p>
            </div>
            <div className="col-lg-4">
              <a href="https://creen.ai" className="btn btn-light btn-lg w-100">Visit Creen AI Generator</a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-4 bg-dark text-white">
        <div className="container">
          <div className="col-12 text-center">
            <p className="mb-0">AI Social Media Tools • Free AI Models for Images, Videos &amp; Captions • 2026</p>
            <a href="/sam-store" className="text-white-50 small">← Back to Sam&apos;s Store</a>
          </div>
        </div>
      </footer>
    </div>
  );
}