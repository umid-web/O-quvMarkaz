try {
        // Standart mavzu — qorong‘i; foydalanuvchi tanlovi saqlanadi
        var t = localStorage.getItem('admin-theme');
        if (t !== 'light' && t !== 'dark') t = 'dark';
        document.documentElement.setAttribute('data-theme', t);
        document.documentElement.style.colorScheme = t;
        var m = document.querySelector('meta[name="theme-color"]');
        if (m) m.setAttribute('content', t === 'dark' ? '#0b1424' : '#f5f8fc');
      } catch { /* Storage may be unavailable in private browsing. */ }
