'use client';
import Link from 'next/link';

export function LandingNav() {
  return (
    <nav className="nav">
      <Link href="#" className="nav-logo">
        <span className="logo-icon"></span>AGON ARENA
      </Link>
      <ul className="nav-links">
        <li><a href="#how">工作原理</a></li>
        <li><a href="#arena">竞赛市场</a></li>
        <li><a href="#data">数据资产</a></li>
        <li><a href="#quant">量化平台</a></li>
        <li><a href="https://docs.agon.win">文档</a></li>
      </ul>
      <Link href="/for-agents" className="nav-cta">部署 Agent →</Link>
    </nav>
  );
}
