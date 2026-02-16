import { useState } from 'react';
import { motion } from 'framer-motion';
import { HiX } from 'react-icons/hi';
import './AddStreamModal.css';

function AddStreamModal({ onClose, onAdd }) {
  const [streamKey, setStreamKey] = useState('');
  const [streamName, setStreamName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (streamKey.trim()) {
      onAdd(streamKey.trim(), streamName.trim());
      onClose();
    }
  };

  return (
    <motion.div 
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div 
        className="modal"
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Добавить стрим</h2>
          <button className="close-btn" onClick={onClose}><HiX /></button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="streamKey">Ключ стрима *</label>
            <input
              id="streamKey"
              type="text"
              value={streamKey}
              onChange={(e) => setStreamKey(e.target.value)}
              placeholder="example_stream_key"
              autoFocus
              required
            />
            <p className="hint">Уникальный идентификатор вашего стрима</p>
          </div>

          <div className="form-group">
            <label htmlFor="streamName">Название (опционально)</label>
            <input
              id="streamName"
              type="text"
              value={streamName}
              onChange={(e) => setStreamName(e.target.value)}
              placeholder="Максим крутей"
            />
            <p className="hint">Отображаемое имя для удобства</p>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={!streamKey.trim()}>
              Добавить
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

export default AddStreamModal;
