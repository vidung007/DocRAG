import React, { useState, useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import './HomePage.css';

const features = [
	{
		icon: 'fas fa-robot',
		title: 'AI-Powered Chat',
		desc: 'Chat with your documents using the latest LLMs. Get instant, context-aware answers.',
	},
	{
		icon: 'fas fa-cloud-upload-alt',
		title: 'Seamless Uploads',
		desc: 'Drag & drop PDFs, DOCX, CSV, and more. Securely stored and ready for analysis.',
	},
	{
		icon: 'fas fa-shield-alt',
		title: 'Enterprise Security',
		desc: 'Bank-grade encryption, AWS S3, and Cognito authentication. Your data is always protected.',
	},
	{
		icon: 'fas fa-chart-bar',
		title: 'Smart Analytics',
		desc: 'Track usage, monitor insights, and optimize your workflow with a beautiful dashboard.',
	},
	{
		icon: 'fas fa-brain',
		title: 'Multi-LLM Support',
		desc: 'Switch between GPT-4, Claude, Llama, and more for the best results.',
	},
	{
		icon: 'fas fa-bolt',
		title: 'Lightning Fast',
		desc: 'Get answers in seconds, even with large documents. No waiting, just results.',
	},
];

const HomePage = () => {
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [scrolled, setScrolled] = useState(false);

	useEffect(() => {
		const checkAuth = async () => {
			try {
				setIsLoading(true);
				const response = await fetch('/check-auth', { credentials: 'include' });
				const data = await response.json();
				setIsAuthenticated(data.isAuthenticated);
			} catch {
				setIsAuthenticated(false);
			} finally {
				setIsLoading(false);
			}
		};
		checkAuth();
		const handleScroll = () => setScrolled(window.scrollY > 50);
		window.addEventListener('scroll', handleScroll);
		return () => window.removeEventListener('scroll', handleScroll);
	}, []);

	if (isAuthenticated && !isLoading) return <Navigate to="/home" replace />;
	if (isLoading)
		return (
			<div className="loading-container">
				<div className="loading-spinner"></div>
				<p>Loading...</p>
			</div>
		);

	return (
		<div className="home-page redesigned">
			<section className="hero-glass">
				<div className="aurora-bg">
					<div className="aurora-shape aurora-shape1"></div>
					<div className="aurora-shape aurora-shape2"></div>
					<div className="aurora-shape aurora-shape3"></div>
					<div className="aurora-shape aurora-shape4"></div>
				</div>
				<div className="hero-bg-shape"></div>
				<div className="container hero-content">
					<h2 className="hero-app-title">
						DocChat <span>AI</span>
					</h2>
					<h1 className="hero-title">Revolutionize Your Document Workflow</h1>
					<p className="hero-subtitle">
						AI-powered, secure, and lightning fast. Chat with your files, extract insights, and automate
						knowledge—all in one place.
					</p>
					<a
						href={`${process.env.REACT_APP_API_URL}/login`}
						className="btn btn-cta"
					>
						Get Started Free <i className="fas fa-arrow-right"></i>
					</a>
				</div>
			</section>

			<section className="features-modern">
				<div className="container">
					<h2 className="features-title">Why Choose DocChat AI?</h2>
					<div className="features-grid-modern">
						{features.map((f, i) => (
							<div
								className="feature-modern-card"
								key={i}
								style={{ animationDelay: `${0.1 * i}s` }}
							>
								<div className="feature-modern-icon">
									<i className={f.icon}></i>
								</div>
								<h3>{f.title}</h3>
								<p>{f.desc}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			<footer className="footer-modern">
				<div className="container footer-container">
					<div className="footer-brand">
						<span className="logo-text">
							DocChat <span>AI</span>
						</span>
						<p className="footer-desc">
							AI-powered document chat for modern teams. Secure, fast, and easy to use.
						</p>
					</div>
					{/* Removed footer-links-grid for a simpler, service-focused footer */}
				</div>
				<div className="footer-bottom-modern">
					<span>© {new Date().getFullYear()} Gallega Soft. All rights reserved.</span>
				</div>
			</footer>
		</div>
	);
};

export default HomePage;