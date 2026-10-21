'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('adminLoginForm');
  const tokenInput = document.getElementById('adminToken');
  const status = document.getElementById('adminStatus');
  const loadButton = document.getElementById('adminLoad');
  const logout = document.getElementById('adminLogout');
  const requestsPanel = document.getElementById('requestsPanel');
  const reviewsPanel = document.getElementById('reviewsPanel');
  const requestsList = document.getElementById('requestsList');
  const reviewsList = document.getElementById('adminReviewsList');
  let token = '';

  const el = (tag, cls, value) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const setStatus = (value, state = '') => {
    status.textContent = value;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
  };
  const date = (raw) => {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU');
  };
  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(options.headers || {}) }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Запрос не выполнен.');
    return result;
  }

  function renderRequests(items) {
    requestsList.replaceChildren();
    if (!items.length) {
      requestsList.append(el('p', 'small-note', 'Заявок пока нет.'));
      return;
    }
    items.forEach((item) => {
      const card = el('article', 'review-card');
      card.style.marginTop = '12px';
      const header = el('div', 'review-header');
      header.append(el('strong', '', `${item.name} — ${item.specialty}`), el('span', 'status-pill', item.status === 'new' ? 'Новая' : item.status === 'contacted' ? 'Связались' : 'Закрыта'));
      const details = el('div', 'review-text');
      details.textContent = `Контакт: ${item.contact}\nДата: ${date(item.createdAt)}\nТип: ${item.purpose === 'message' ? 'Сообщение координатору' : 'Заявка на подбор/консультацию'}\nТекст: ${item.note || 'Не указан'}`;
      const actions = el('div', 'admin-actions');
      const statusSelect = el('select');
      statusSelect.setAttribute('aria-label', 'Статус заявки');
      [['new', 'Новая'], ['contacted', 'Связались'], ['closed', 'Закрыта']].forEach(([value, label]) => {
        const option = el('option', '', label); option.value = value; option.selected = item.status === value; statusSelect.append(option);
      });
      const save = el('button', 'btn btn--mini', 'Сохранить статус');
      save.type = 'button';
      save.addEventListener('click', async () => {
        save.disabled = true;
        try { await api(`/api/admin/requests/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ status: statusSelect.value }) }); setStatus('Статус заявки обновлён.', 'ok'); await loadData(); }
        catch (error) { setStatus(error.message, 'error'); }
        finally { save.disabled = false; }
      });
      actions.append(statusSelect, save);
      card.append(header, details, actions);
      requestsList.append(card);
    });
  }

  function renderReviews(items) {
    reviewsList.replaceChildren();
    if (!items.length) {
      reviewsList.append(el('p', 'small-note', 'Отзывов пока нет.'));
      return;
    }
    items.forEach((item) => {
      const card = el('article', 'review-card');
      card.style.marginTop = '12px';
      const header = el('div', 'review-header');
      header.append(el('strong', '', `${item.name} · ${item.rating}/5`), el('span', 'status-pill', item.hidden ? 'Скрыт' : 'Опубликован'));
      const body = el('div', 'review-text', item.text);
      const meta = el('div', 'admin-meta', date(item.createdAt));
      const actions = el('div', 'admin-actions');
      const visibility = el('button', 'btn btn--mini', item.hidden ? 'Опубликовать' : 'Скрыть');
      visibility.type = 'button';
      visibility.addEventListener('click', async () => {
        visibility.disabled = true;
        try { await api(`/api/admin/reviews/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ hidden: !item.hidden }) }); setStatus('Статус отзыва изменён.', 'ok'); await loadData(); }
        catch (error) { setStatus(error.message, 'error'); }
        finally { visibility.disabled = false; }
      });
      const remove = el('button', 'btn btn--mini btn--ghost', 'Удалить');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!window.confirm('Удалить этот отзыв без возможности восстановления?')) return;
        remove.disabled = true;
        try { await api(`/api/admin/reviews/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); setStatus('Отзыв удалён.', 'ok'); await loadData(); }
        catch (error) { setStatus(error.message, 'error'); }
        finally { remove.disabled = false; }
      });
      actions.append(visibility, remove);
      card.append(header, body, meta, actions);
      reviewsList.append(card);
    });
  }

  async function loadData() {
    loadButton.disabled = true;
    setStatus('Загружаем заявки и отзывы…');
    try {
      const result = await api('/api/admin/data');
      renderRequests(result.requests || []);
      renderReviews(result.reviews || []);
      requestsPanel.hidden = false;
      reviewsPanel.hidden = false;
      setStatus(`Данные загружены. Заявок: ${(result.requests || []).length}; отзывов: ${(result.reviews || []).length}.`, 'ok');
    } catch (error) {
      requestsPanel.hidden = true;
      reviewsPanel.hidden = true;
      setStatus(error.message, 'error');
    } finally {
      loadButton.disabled = false;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    token = tokenInput.value.trim();
    if (!token) return setStatus('Введите административный токен.', 'error');
    await loadData();
  });
  logout.addEventListener('click', () => {
    token = '';
    tokenInput.value = '';
    requestsPanel.hidden = true;
    reviewsPanel.hidden = true;
    setStatus('Токен очищен.');
  });
});
