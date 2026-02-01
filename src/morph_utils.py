# -*- coding: utf-8 -*-
"""
俄语形态分析工具模块
使用 pymorphy2 进行词法分析、原型识别等功能
"""

import re
from typing import Dict, List, Tuple, Optional, Any
from functools import lru_cache

try:
    import pymorphy2  # type: ignore
    PYMORPHY2_AVAILABLE = True
except ImportError:
    PYMORPHY2_AVAILABLE = False
    pymorphy2 = None


class MorphAnalyzer:
    """俄语形态分析器单例类"""
    
    _instance = None
    _morph = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            if PYMORPHY2_AVAILABLE and pymorphy2 is not None:
                try:
                    cls._instance._morph = pymorphy2.MorphAnalyzer()
                    print("✓ pymorphy2 形态分析器已初始化")
                except Exception as e:
                    print(f"⚠️ pymorphy2 初始化失败: {e}")
                    cls._instance._morph = None
            else:
                print("⚠️ pymorphy2 未安装")
        return cls._instance
    
    def get_lemma(self, word: str) -> str:
        """获取词汇的原型（字典形式）"""
        if not self._morph or not word:
            return word
        
        try:
            parsed = self._morph.parse(word)[0]  # 获取最可能的分析结果
            return parsed.normal_form
        except Exception as e:
            print(f"⚠️ 词 '{word}' 的原型分析失败: {e}")
            return word
    
    def analyze(self, word: str) -> Dict[str, Any]:
        """详细分析一个词汇的形态特征"""
        if not self._morph or not word:
            return {
                'word': word,
                'lemma': word,
                'grammemes': [],
                'POS': None,
                'case': None,
                'gender': None,
                'number': None
            }
        
        try:
            parsed = self._morph.parse(word)[0]
            
            # 提取语法标签
            grammemes = set()
            pos = None
            case = None
            gender = None
            number = None
            
            if parsed.tag and parsed.tag.grammemes:
                grammemes = parsed.tag.grammemes
                
                # 提取常用属性
                if 'anim' in grammemes:
                    pass  # 有生/无生
                if 'ADJF' in str(parsed.tag.POS):
                    pos = 'ADJF'  # 形容词
                elif 'NOUN' in str(parsed.tag.POS):
                    pos = 'NOUN'  # 名词
                elif 'VERB' in str(parsed.tag.POS):
                    pos = 'VERB'  # 动词
                elif 'ADVB' in str(parsed.tag.POS):
                    pos = 'ADVB'  # 副词
                
                # 格数
                for gram in ['nomn', 'gent', 'datv', 'accs', 'ablt', 'loct', 'voct']:
                    if gram in grammemes:
                        case = gram
                        break
                
                # 性别
                for gram in ['masc', 'femn', 'neut']:
                    if gram in grammemes:
                        gender = gram
                        break
                
                # 数量
                if 'sing' in grammemes:
                    number = 'sing'
                elif 'plur' in grammemes:
                    number = 'plur'
            
            return {
                'word': word,
                'lemma': parsed.normal_form,
                'grammemes': list(grammemes),
                'POS': pos or str(parsed.tag.POS) if parsed.tag else None,
                'case': case,
                'gender': gender,
                'number': number
            }
        except Exception as e:
            print(f"⚠️ 词 '{word}' 的详细分析失败: {e}")
            return {
                'word': word,
                'lemma': word,
                'grammemes': [],
                'POS': None,
                'case': None,
                'gender': None,
                'number': None
            }
    
    def batch_get_lemmas(self, words: List[str]) -> Dict[str, str]:
        """批量获取词汇的原型"""
        result = {}
        for word in words:
            if word and word.strip():
                result[word] = self.get_lemma(word)
        return result
    
    def normalize_word(self, word: str) -> str:
        """规范化词汇（移除标点等）"""
        if not word:
            return word
        # 移除末尾的标点符号
        word = re.sub(r'[.,;:!?""«»—\-–…]+$', '', word)
        word = re.sub(r'^[""«»—\-–…]+', '', word)
        return word.strip()


class VocabMatcher:
    """生词本匹配和高亮工具"""
    
    def __init__(self):
        self.morph = MorphAnalyzer()
    
    def prepare_vocab_index(self, vocab_words: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """
        准备生词本索引，使用原型作为键
        
        Args:
            vocab_words: 生词本词汇列表 [{'word': '...', 'meaning': '...', 'lemma': '...'}, ...]
        
        Returns:
            {lemma: {'word': original_word, 'meaning': meaning, ...}, ...}
        """
        index = {}
        for item in vocab_words:
            word = item.get('word', '').strip()
            if not word:
                continue
            
            # 使用现有的 lemma 字段，或者自动计算
            lemma = item.get('lemma') or self.morph.get_lemma(word)
            lemma_lower = lemma.lower()
            
            # 只保留第一个（如果有重复）
            if lemma_lower not in index:
                index[lemma_lower] = {
                    'word': word,
                    'lemma': lemma,
                    'meaning': item.get('meaning', ''),
                    'note': item.get('note', ''),
                    'original_item': item
                }
        
        return index
    
    def find_matches_in_text(self, text: str, vocab_index: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        在文本中查找生词本词汇，使用原型匹配
        
        Args:
            text: 要分析的文本
            vocab_index: 生词本索引（由 prepare_vocab_index 生成）
        
        Returns:
            [{
                'start': 位置,
                'end': 位置,
                'text': '匹配的原始文本',
                'lemma': '原型',
                'vocab_info': {...}
            }, ...]
        """
        if not text or not vocab_index:
            return []
        
        matches = []
        # 将文本按单词分割
        words_with_pos = self._split_text_with_positions(text)
        
        for word, start, end in words_with_pos:
            normalized = self.morph.normalize_word(word)
            if not normalized:
                continue
            
            lemma = self.morph.get_lemma(normalized)
            lemma_lower = lemma.lower()
            
            if lemma_lower in vocab_index:
                matches.append({
                    'start': start,
                    'end': end,
                    'text': word,
                    'normalized': normalized,
                    'lemma': lemma,
                    'lemma_lower': lemma_lower,
                    'vocab_info': vocab_index[lemma_lower]
                })
        
        return matches
    
    def highlight_text(self, text: str, vocab_index: Dict[str, Dict[str, Any]]) -> str:
        """
        生成高亮 HTML，标记生词本中的词汇
        
        Args:
            text: 要高亮的文本
            vocab_index: 生词本索引
        
        Returns:
            包含 <mark> 标签的 HTML
        """
        if not text or not vocab_index:
            return text
        
        matches = self.find_matches_in_text(text, vocab_index)
        if not matches:
            return text
        
        # 按位置反向排序，从后往前替换以避免位置偏移
        matches.sort(key=lambda m: m['start'], reverse=True)
        
        result = text
        for match in matches:
            before = result[:match['start']]
            matched_text = result[match['start']:match['end']]
            after = result[match['end']:]
            
            vocab = match['vocab_info']
            # 生成 mark 标签，带有数据属性便于前端处理
            marked = (
                f'<mark class="vocab-match" '
                f'data-lemma="{self._escape_html(vocab["lemma"])}" '
                f'data-meaning="{self._escape_html(vocab["meaning"])}" '
                f'data-note="{self._escape_html(vocab["note"])}">'
                f'{self._escape_html(matched_text)}</mark>'
            )
            result = before + marked + after
        
        return result
    
    def _split_text_with_positions(self, text: str) -> List[Tuple[str, int, int]]:
        """按单词分割文本并记录位置"""
        # 使用正则表达式匹配俄语单词和其他词汇
        pattern = r'\b[\p{L}]+\b|[\p{L}]+'
        # 在 Python 中使用 \w 的 unicode 变体
        pattern = r"[\wа-яА-ЯёЁ]+"
        
        words = []
        for match in re.finditer(pattern, text):
            words.append((match.group(), match.start(), match.end()))
        
        return words
    
    @staticmethod
    def _escape_html(text: str) -> str:
        """转义 HTML 特殊字符"""
        if not text:
            return ''
        return (text
                .replace('&', '&amp;')
                .replace('<', '&lt;')
                .replace('>', '&gt;')
                .replace('"', '&quot;')
                .replace("'", '&#39;'))


def get_analyzer() -> MorphAnalyzer:
    """获取全局的形态分析器实例"""
    return MorphAnalyzer()


def get_matcher() -> VocabMatcher:
    """获取全局的词汇匹配器实例"""
    return VocabMatcher()
