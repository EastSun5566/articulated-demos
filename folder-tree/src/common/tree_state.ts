import { ElementId, equalsId, IdList, type SavedIdList } from "articulated";
import type { TreeNode, TreeMutation } from "./types";

function elementIdToString(id: ElementId) {
  return `${id.bunchId}:${id.counter}`;
}

export interface TreeStateData {
  idListJson: SavedIdList;
  nodesJson: [string, TreeNode][];
}

/**
 * Persistent tree state: apply never modifies this version. Successful updates
 * return a new state; skipped operations return this state unchanged.
 * Unchanged IdList structure and node objects are shared between versions.
 */
export class TreeState {
  // One global list determines sibling order by filtering on parentId. Nodes
  // from different parents may interleave; subtrees need not be contiguous.
  // This avoids maintaining a separate IdList for every folder.
  private idList: IdList;
  private nodes: Map<string, TreeNode>; // key = elementIdToString(id)

  constructor(
    idList: IdList = IdList.new(),
    nodes: Map<string, TreeNode> = new Map()
  ) {
    this.idList = idList;
    this.nodes = nodes;
  }

  apply(mutation: TreeMutation) {
    let newIdList = this.idList;
    const newNodes = new Map(this.nodes);

    switch (mutation.type) {
      case "createNode": {
        const { id, name, nodeType, parentId, afterSiblingId } = mutation;

        if (parentId !== null) {
          const parent = this.getNode(parentId);
          if (!parent || parent.type !== "folder") {
            console.warn("Parent not found or not a folder, skipping create");
            return this;
          }
        }

        newIdList = newIdList.insertAfter(afterSiblingId, id);
        newNodes.set(elementIdToString(id), {
          id,
          name,
          type: nodeType,
          parentId,
        });

        return new TreeState(newIdList, newNodes);
      }

      case "deleteNode": {
        const { id } = mutation;
        const node = this.getNode(id);
        if (!node) return this;

        // if folder, delete all children recursively
        if (node.type === "folder") {
          const children = this.getChildren(id);
          for (const child of children) {
            const childMutation: TreeMutation = {
              type: "deleteNode",
              id: child.id,
            };
            const tempState = new TreeState(newIdList, newNodes).apply(
              childMutation
            );
            newIdList = tempState.idList;
            tempState.nodes.forEach((v, k) => newNodes.set(k, v));
          }
        }

        newIdList = newIdList.delete(id);
        newNodes.delete(elementIdToString(id));

        return new TreeState(newIdList, newNodes);
      }

      case "renameNode": {
        const { id, newName } = mutation;
        const node = this.getNode(id);
        if (!node) return this;

        newNodes.set(elementIdToString(id), { ...node, name: newName });
        return new TreeState(newIdList, newNodes);
      }

      case "moveNode": {
        const { id, newParentId } = mutation;
        const node = this.getNode(id);
        if (!node) return this;

        // check new parent validity
        if (newParentId !== null) {
          const newParent = this.getNode(newParentId);
          if (!newParent || newParent.type !== "folder") {
            console.warn("New parent not found or not a folder, skipping move");
            return this;
          }

          // Prevent moving to its own descendant (which would cause a cycle)
          if (this.isDescendant(newParentId, id)) {
            console.warn("Cannot move to descendant, skipping move");
            return this;
          }
        }

        newNodes.set(elementIdToString(id), { ...node, parentId: newParentId });

        return new TreeState(newIdList, newNodes);
      }
    }
  }

  getNode(id: ElementId) {
    return this.nodes.get(elementIdToString(id));
  }

  getAllNodes() {
    const result: TreeNode[] = [];
    for (const id of this.idList) {
      const node = this.getNode(id);
      if (node) result.push(node);
    }
    return result;
  }

  getChildren(parentId: ElementId | null) {
    const parentKey = parentId ? elementIdToString(parentId) : null;
    return this.getAllNodes().filter(
      (node) =>
        (parentKey === null && node.parentId === null) ||
        (node.parentId && elementIdToString(node.parentId) === parentKey)
    );
  }

  private isDescendant(descendantId: ElementId, ancestorId: ElementId) {
    let current = this.getNode(descendantId);
    while (current && current.parentId) {
      if (equalsId(current.parentId, ancestorId)) return true;
      current = this.getNode(current.parentId);
    }
    return false;
  }

  save() {
    return {
      idListJson: this.idList.save(),
      nodesJson: Array.from(this.nodes.entries()),
    };
  }

  static load(data: TreeStateData) {
    const idList = IdList.load(data.idListJson);
    const nodes = new Map<string, TreeNode>(data.nodesJson);
    return new TreeState(idList, nodes);
  }
}
