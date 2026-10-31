//! Node content as the host application's type describes it (ADR-0013): what inspection and the
//! changes Comb tells report, built from the content the engine keeps when asked.

use comb_engine::content::{Direction, Element, Role};

use super::codes::direction_of;
use super::data::rgb_of;
use super::{ContentData, ContentElement, NodeContent, Segment, TextRole, Trend, TrendDirection};

impl ContentData {
    /// The colour of the badge or the trend of the metric at `element`, which the bridge checked.
    pub(crate) fn color(&self, element: usize) -> u32 {
        rgb_of(self.colors[element])
    }

    /// The segments of the progress bar at `element`, as the host application's type describes
    /// them.
    fn segments_of(&self, element: usize) -> Vec<Segment> {
        self.view()
            .segments(element)
            .map(|s| Segment {
                fraction: self.fractions[s],
                color: rgb_of(self.segment_colors[s]),
            })
            .collect()
    }

    /// The content of the node at `node`, as the host application's type describes it: what
    /// inspection and the changes Comb tells report, built when asked.
    pub(crate) fn content_of(&self, node: usize) -> NodeContent {
        let count = if node + 1 < self.row_bounds.len() {
            self.view().rows(node).len()
        } else {
            0
        };
        let mut rows: Vec<Vec<ContentElement>> = (0..count).map(|_| Vec::new()).collect();
        for (row, _, element, at) in self.elements_of(node) {
            let shown = self.element(element, at.text);
            let text = shown.text().to_owned();
            let weight = Some(self.weights[element]);
            rows[row as usize].push(match shown {
                Element::Action { .. } => ContentElement::Action {
                    text,
                    id: self.name(at.name).to_owned(),
                    weight,
                },
                Element::Progress => ContentElement::Progress {
                    segments: self.segments_of(element),
                    weight,
                },
                Element::Icon => ContentElement::Icon {
                    name: self.name(at.name).to_owned(),
                    weight,
                },
                Element::Badge { .. } => ContentElement::Badge {
                    text,
                    color: self.color(element),
                    weight,
                },
                Element::Metric {
                    caption,
                    value,
                    trend,
                } => ContentElement::Metric {
                    caption: caption.to_owned(),
                    value: value.to_owned(),
                    trend: Trend {
                        text: trend.to_owned(),
                        direction: match direction_of(self.directions[element]) {
                            Some(Direction::Up) => TrendDirection::Up,
                            Some(Direction::Down) => TrendDirection::Down,
                            _ => TrendDirection::Flat,
                        },
                        color: self.color(element),
                    },
                    weight,
                },
                Element::Text { role, .. } => ContentElement::Text {
                    role: match role {
                        Role::Title => TextRole::Title,
                        Role::Caption => TextRole::Caption,
                        Role::Body => TextRole::Body,
                    },
                    text,
                    weight,
                },
            });
        }
        NodeContent(rows)
    }
}
