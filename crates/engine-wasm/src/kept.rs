//! What the bridge keeps of node content between calls, once `graph_data` has read and checked
//! it: the content of the nodes by slot (`store`), and the buffers of what a query draws of it
//! (`drawn`).

mod drawn;
mod store;

pub(crate) use drawn::Drawn;
pub(crate) use store::ContentStore;
